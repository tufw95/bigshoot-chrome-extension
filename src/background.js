const DEFAULT_SETTINGS = Object.freeze({
  destination: "download",
});

const MENU_ID = "bigshoot-settings";
const activeCaptures = new Set();
const badgeResetTimers = new Map();

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
  if (!tab?.id || !isSupportedUrl(tab.url)) {
    await showBadge(tab?.id, "!", "#d74b3f", "Chrome does not allow this page to be captured.");
    return;
  }
  if (activeCaptures.has(tab.id)) {
    return;
  }

  activeCaptures.add(tab.id);
  let debuggerAttached = false;

  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    await showBadge(tab.id, "...", "#0b7f8c", "Capturing the full page...", 0);
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    debuggerAttached = true;
    await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");

    const metrics = await waitForStableLayout(tab.id);
    const clip = sanitizeClip(metrics?.cssContentSize || metrics?.contentSize);
    const result = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { ...clip, scale: 1 },
      },
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
    await showBadge(tab.id, "!", "#d74b3f", humanizeCaptureError(error));
    throw error;
  } finally {
    if (debuggerAttached) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
    activeCaptures.delete(tab.id);
  }
}

async function waitForStableLayout(tabId) {
  let previous = "";
  let stableSamples = 0;
  let latestMetrics;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    latestMetrics = await chrome.debugger.sendCommand(
      { tabId },
      "Page.getLayoutMetrics",
    );
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

function sanitizeClip(contentSize) {
  const width = Math.ceil(Number(contentSize?.width));
  const height = Math.ceil(Number(contentSize?.height));
  const maxDimension = 32767;

  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width < 1
    || height < 1
    || width > maxDimension
    || height > maxDimension
  ) {
    throw new Error(`The page size ${width}x${height} exceeds Chrome's screenshot limit.`);
  }

  return { x: 0, y: 0, width, height };
}

async function copyImageToClipboard(tabId, dataUrl) {
  const frameTree = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree");
  const frameId = frameTree?.frameTree?.frame?.id;
  if (!frameId) {
    throw new Error("Chrome could not find the active page frame.");
  }

  const world = await chrome.debugger.sendCommand(
    { tabId },
    "Page.createIsolatedWorld",
    {
      frameId,
      worldName: "Bigshoot clipboard",
      grantUniveralAccess: false,
    },
  );
  const result = await chrome.debugger.sendCommand(
    { tabId },
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

function humanizeCaptureError(error) {
  const message = normalizeError(error);
  if (/Another debugger|already attached|target is already being debugged/i.test(message)) {
    return "Close DevTools for this tab, then try again.";
  }
  if (/Cannot access|permission|not allowed/i.test(message)) {
    return "Chrome does not allow this page to be captured.";
  }
  return message;
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error || "Something went wrong.");
}
