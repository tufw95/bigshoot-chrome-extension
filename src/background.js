const DEFAULT_SETTINGS = Object.freeze({
  destination: "download",
});

const MENU_ID = "bigshoot-settings";
const activeCaptures = new Set();
const badgeResetTimers = new Map();
const CAPTURE_TIMEOUT_MS = 20_000;

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(saved);
  await chrome.storage.sync.remove("padding");

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Bigshoot settings",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener((tab) => {
  captureFullPage(tab).catch(() => {});
});

async function captureFullPage(tab) {
  if (!tab?.id) {
    return;
  }

  const tabUrl = await resolveTabUrl(tab);
  const fileAccessAllowed = await chrome.extension.isAllowedFileSchemeAccess();
  const preCaptureViewport = await readPageViewport(tab.id).catch(() => null);
  if (tabUrl && !isSupportedUrl(tabUrl)) {
    await showBadge(tab.id, "!", "#d74b3f", "Chrome does not allow this page to be captured.");
    return;
  }
  if (activeCaptures.has(tab.id)) {
    await showBadge(tab.id, "...", "#0b7f8c", "A full-page capture is already in progress.", 1600);
    return;
  }

  activeCaptures.add(tab.id);
  let debuggerAttached = false;
  let pagePrepared = false;

  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    await showBadge(tab.id, "...", "#0b7f8c", "Capturing the full page...", 0);
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    debuggerAttached = true;
    await cdp(tab.id, "Page.enable");

    pagePrepared = true;
    const pagePlan = await preparePageForCapture(tab.id);

    const metrics = await waitForCaptureReady(tab.id);
    const clip = sanitizeClip(metrics?.cssContentSize || metrics?.contentSize);
    if (pagePlan?.expanded) {
      if (Number.isFinite(pagePlan.originalDocumentSize?.width)) {
        clip.width = Math.min(clip.width, Math.ceil(pagePlan.originalDocumentSize.width));
      }
      if (Number.isFinite(preCaptureViewport?.width)) {
        clip.width = Math.min(clip.width, Math.ceil(preCaptureViewport.width));
      }
    }
    clip.scale = getCssPixelScale(metrics);
    const result = await cdp(
      tab.id,
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        optimizeForSpeed: true,
        clip,
      },
      CAPTURE_TIMEOUT_MS,
    );

    if (!result?.data) {
      throw new Error("Chrome did not return screenshot data.");
    }

    const dataUrl = `data:image/png;base64,${result.data}`;
    if (settings.destination === "clipboard") {
      await copyImageToClipboard(tab.id, dataUrl);
    } else {
      await chrome.downloads.download({
        url: dataUrl,
        filename: buildFilename(tab.title),
        conflictAction: "uniquify",
      });
    }

    const title = settings.destination === "clipboard"
      ? "Full-page screenshot copied to the clipboard."
      : "Full-page screenshot saved.";
    await showBadge(tab.id, "OK", "#126b55", title);
  } catch (error) {
    await showBadge(
      tab.id,
      "!",
      "#d74b3f",
      humanizeCaptureError(error, { tabUrl, fileAccessAllowed }),
    );
    throw error;
  } finally {
    if (pagePrepared) {
      await restorePageAfterCapture(tab.id);
    }
    if (debuggerAttached) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
    activeCaptures.delete(tab.id);
  }
}

async function preparePageForCapture(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/capture-page.js"],
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__bigshootFullPageCapture?.prepare(),
  });
  await waitForPagePaint(tabId);
  return result?.result;
}

async function readPageViewport(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/capture-page.js"],
  });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__bigshootFullPageCapture?.readStableViewport(),
  });
  return result?.result;
}

async function restorePageAfterCapture(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__bigshootFullPageCapture?.restore(),
  }).catch(() => {});
}

async function waitForPagePaint(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
  });
}

function sanitizeClip(contentSize) {
  const width = Number(contentSize?.width);
  const height = Number(contentSize?.height);

  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width < 1
    || height < 1
  ) {
    throw new Error("Chrome could not measure the full page.");
  }

  return { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) };
}

function getCssPixelScale(metrics) {
  const cssWidth = Number(metrics?.cssVisualViewport?.clientWidth);
  const deviceWidth = Number(metrics?.visualViewport?.clientWidth);
  if (!Number.isFinite(cssWidth) || !Number.isFinite(deviceWidth) || cssWidth < 1) {
    return 1;
  }
  return Math.min(1, cssWidth / deviceWidth);
}

async function waitForCaptureReady(tabId) {
  let previous = "";
  let stableSamples = 0;
  let latestMetrics;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    latestMetrics = await cdp(tabId, "Page.getLayoutMetrics");
    const viewport = latestMetrics?.cssVisualViewport;
    const content = latestMetrics?.cssContentSize || latestMetrics?.contentSize;
    const current = [
      viewport?.clientWidth,
      viewport?.clientHeight,
      viewport?.pageX,
      viewport?.pageY,
      content?.width,
      content?.height,
    ].join(":");

    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) {
      return latestMetrics;
    }
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return latestMetrics;
}

async function copyImageToClipboard(tabId, dataUrl) {
  const frameTree = await cdp(tabId, "Page.getFrameTree");
  const frameId = frameTree?.frameTree?.frame?.id;
  if (!frameId) {
    throw new Error("Chrome could not find the active page frame.");
  }

  const world = await cdp(
    tabId,
    "Page.createIsolatedWorld",
    {
      frameId,
      worldName: "Bigshoot clipboard",
      grantUniveralAccess: false,
    },
  );
  const result = await cdp(
    tabId,
    "Runtime.callFunctionOn",
    {
      executionContextId: world.executionContextId,
      functionDeclaration: writeClipboardInPage.toString(),
      arguments: [{ value: dataUrl }],
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
  );

  if (result?.exceptionDetails || result?.result?.value !== true) {
    const message = result?.exceptionDetails?.exception?.description
      || result?.exceptionDetails?.text
      || "Chrome could not copy the PNG.";
    throw new Error(message);
  }
}

async function writeClipboardInPage(dataUrl) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("The Clipboard API is unavailable on this page.");
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
  return true;
}

function cdp(tabId, method, commandParams = {}, timeout = 5000) {
  return withTimeout(
    chrome.debugger.sendCommand({ tabId }, method, commandParams),
    timeout,
    `${method} timed out.`,
  );
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function buildFilename(title = "page") {
  const safeTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeTitle || "page"}-full-page-${stamp}.png`;
}

function isSupportedUrl(url = "") {
  return /^(https?|file):/i.test(url);
}

async function resolveTabUrl(tab) {
  if (tab.url) {
    return tab.url;
  }
  const latest = await chrome.tabs.get(tab.id).catch(() => null);
  return latest?.url || "";
}

async function showBadge(tabId, text, color, title, duration = 4000) {
  if (!tabId) {
    return;
  }

  clearTimeout(badgeResetTimers.get(tabId));
  badgeResetTimers.delete(tabId);
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({ tabId, title: `Bigshoot: ${title}` });

  if (duration > 0) {
    const timer = setTimeout(() => {
      badgeResetTimers.delete(tabId);
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      chrome.action.setTitle({ tabId, title: "Capture the full page" }).catch(() => {});
    }, duration);
    badgeResetTimers.set(tabId, timer);
  }
}

function humanizeCaptureError(error, context = {}) {
  const message = normalizeError(error);
  if (/Another debugger|already attached|target is already being debugged/i.test(message)) {
    return "Close DevTools for this tab, then try again.";
  }
  if (/Cannot access|permission|not allowed/i.test(message)) {
    return /^file:/i.test(context.tabUrl || "") || (!context.tabUrl && !context.fileAccessAllowed)
      ? "Enable Allow access to file URLs for Bigshoot in chrome://extensions."
      : "Chrome does not allow this page to be captured.";
  }
  if (/timed out/i.test(message)) {
    return "The page took too long to capture. Wait for it to finish loading, then try again.";
  }
  if (/unable to capture|capture screenshot|image is too large|allocation failed|not enough memory/i.test(message)) {
    return "This page is too large for Chrome to capture in one image.";
  }
  return message;
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error || "Something went wrong.");
}
