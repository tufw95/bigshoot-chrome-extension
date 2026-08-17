const DEFAULT_SETTINGS = Object.freeze({
  destination: "download",
});

const MENU_ID = "bigshoot-settings";
const activeCaptures = new Set();
const badgeResetTimers = new Map();
const clipboardPayloads = new Map();
const CAPTURE_TIMEOUT_MS = 20_000;
const CLIPBOARD_TIMEOUT_MS = 1_500;
const WARM_SCROLL_SETTLE_MS = 45;
const MAX_WARM_SCROLL_STEPS = 16;
const MAX_NATIVE_PIXELS = 50_000_000;
const MAX_CAPTURE_DIMENSION = 32_767;

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BIGSHOOT_CLIPBOARD_REQUEST") {
    return false;
  }
  sendResponse({ dataUrl: clipboardPayloads.get(message.token) || null });
  return false;
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
    let metrics = await waitForCaptureReady(tab.id);
    let clip = clampCaptureClip(
      sanitizeClip(metrics?.cssContentSize || metrics?.contentSize),
      pagePlan,
      preCaptureViewport,
    );
    await warmPageByScrolling(tab.id, metrics, clip);
    metrics = await waitForCaptureReady(tab.id);
    clip = clampCaptureClip(
      sanitizeClip(metrics?.cssContentSize || metrics?.contentSize),
      pagePlan,
      preCaptureViewport,
    );
    clip.scale = getCaptureScale(metrics, clip);
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
      try {
        await copyImageInActivePage(tab.id, dataUrl);
      } catch {
        // Local files and locked-down pages may reject the active-page Clipboard API.
        // Release the debugger before using the focused extension popup fallback.
        await releaseCaptureResources(tab.id, { pagePrepared, debuggerAttached });
        pagePrepared = false;
        debuggerAttached = false;
        await copyImageInFocusedPopup(dataUrl);
      }
      await releaseCaptureResources(tab.id, { pagePrepared, debuggerAttached });
      pagePrepared = false;
      debuggerAttached = false;
    } else {
      // Detach before handing the PNG to Chrome Downloads so its debugger infobar disappears
      // as soon as the screenshot is ready, rather than waiting for the file write to finish.
      await releaseCaptureResources(tab.id, { pagePrepared, debuggerAttached });
      pagePrepared = false;
      debuggerAttached = false;
      await chrome.downloads.download({
        url: dataUrl,
        filename: buildFilename(tab.title),
        conflictAction: "uniquify",
      });
    }

    const title = settings.destination === "clipboard"
      ? "Full-page screenshot copied to the clipboard."
      : "Full-page screenshot saved.";
    await showCaptureToast(
      tab.id,
      settings.destination === "clipboard" ? "Copied to clipboard" : "Saved to device",
    );
    await showBadge(tab.id, "OK", "#126b55", title, 2200);
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
      await detachDebugger(tab.id);
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

async function releaseCaptureResources(tabId, state) {
  if (state.debuggerAttached) {
    await detachDebugger(tabId);
  }
  if (state.pagePrepared) {
    await restorePageAfterCapture(tabId);
  }
}

async function detachDebugger(tabId) {
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function showCaptureToast(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (toastMessage) => {
      const existing = document.querySelector("#bigshoot-capture-toast");
      existing?.remove();

      const toast = document.createElement("div");
      toast.id = "bigshoot-capture-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.style.cssText = [
        "position:fixed",
        "right:20px",
        "bottom:20px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:10px",
        "max-width:min(360px,calc(100vw - 40px))",
        "padding:12px 15px",
        "color:#f5f1e8",
        "background:#111820",
        "border:1px solid rgba(186,244,216,.5)",
        "border-radius:10px",
        "box-shadow:0 12px 30px rgba(17,24,32,.24)",
        "font:600 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "letter-spacing:.01em",
        "opacity:0",
        "transform:translateY(8px)",
      ].join(";");

      const icon = document.createElement("span");
      icon.textContent = "OK";
      icon.style.cssText = "display:grid;place-items:center;min-width:26px;height:26px;color:#111820;background:#baf4d8;border-radius:50%;font:700 9px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:.04em";
      const copy = document.createElement("span");
      copy.textContent = toastMessage;
      toast.append(icon, copy);
      document.documentElement.append(toast);

      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        toast.style.opacity = "1";
      } else {
        requestAnimationFrame(() => {
          toast.style.transition = "opacity 180ms ease, transform 180ms ease";
          toast.style.opacity = "1";
          toast.style.transform = "translateY(0)";
        });
      }

      const hide = () => {
        if (!toast.isConnected) {
          return;
        }
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        setTimeout(() => toast.remove(), reducedMotion ? 0 : 200);
      };
      setTimeout(hide, 2200);
    },
    args: [message],
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

function clampCaptureClip(clip, pagePlan, viewport) {
  if (!pagePlan?.expanded) {
    return clip;
  }
  if (pagePlan.captureRect) {
    clip.x = pagePlan.captureRect.x;
    clip.y = pagePlan.captureRect.y;
    clip.width = pagePlan.captureRect.width;
    return clip;
  }
  if (Number.isFinite(pagePlan.originalDocumentSize?.width)) {
    clip.width = Math.min(clip.width, Math.ceil(pagePlan.originalDocumentSize.width));
  }
  if (Number.isFinite(viewport?.width)) {
    clip.width = Math.min(clip.width, Math.ceil(viewport.width));
  }
  return clip;
}

function getCssPixelScale(metrics) {
  const cssWidth = Number(metrics?.cssVisualViewport?.clientWidth);
  const deviceWidth = Number(metrics?.visualViewport?.clientWidth);
  if (!Number.isFinite(cssWidth) || !Number.isFinite(deviceWidth) || cssWidth < 1) {
    return 1;
  }
  return Math.min(1, cssWidth / deviceWidth);
}

function getDevicePixelRatio(metrics) {
  const cssWidth = Number(metrics?.cssVisualViewport?.clientWidth);
  const deviceWidth = Number(metrics?.visualViewport?.clientWidth);
  if (!Number.isFinite(cssWidth) || !Number.isFinite(deviceWidth) || cssWidth < 1) {
    return 1;
  }
  return Math.max(1, deviceWidth / cssWidth);
}

function getCaptureScale(metrics, clip) {
  const devicePixelRatio = getDevicePixelRatio(metrics);
  const nativeWidth = clip.width * devicePixelRatio;
  const nativeHeight = clip.height * devicePixelRatio;
  if (
    nativeWidth <= MAX_CAPTURE_DIMENSION
    && nativeHeight <= MAX_CAPTURE_DIMENSION
    && nativeWidth * nativeHeight <= MAX_NATIVE_PIXELS
  ) {
    return 1;
  }
  return getCssPixelScale(metrics);
}

async function warmPageByScrolling(tabId, metrics, clip) {
  const viewportHeight = Number(metrics?.cssVisualViewport?.clientHeight);
  const pageHeight = Number(clip?.height);
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(pageHeight) || pageHeight <= viewportHeight + 2) {
    await scrollPageTo(tabId, 0, 0);
    return;
  }

  const maxScroll = Math.max(0, pageHeight - viewportHeight);
  const stepCount = Math.min(
    MAX_WARM_SCROLL_STEPS,
    Math.max(1, Math.ceil(maxScroll / Math.max(480, viewportHeight * 0.85))),
  );
  const positions = [];
  for (let index = 0; index <= stepCount; index += 1) {
    positions.push(Math.round((maxScroll * index) / stepCount));
  }

  for (const y of positions) {
    await scrollPageTo(tabId, 0, y);
    await new Promise((resolve) => setTimeout(resolve, WARM_SCROLL_SETTLE_MS));
  }
  await scrollPageTo(tabId, 0, 0);
}

async function scrollPageTo(tabId, x, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async (targetX, targetY) => globalThis.__bigshootFullPageCapture?.scrollTo(targetX, targetY),
    args: [x, y],
  });
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
    if (stableSamples >= 1) {
      return latestMetrics;
    }
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return latestMetrics;
}

async function copyImageInActivePage(tabId, dataUrl) {
  const pageGlobal = await cdp(
    tabId,
    "Runtime.evaluate",
    {
      expression: "globalThis",
      returnByValue: false,
      userGesture: true,
    },
  );
  const objectId = pageGlobal?.result?.objectId;
  if (!objectId) {
    throw new Error("Chrome could not access the active page context.");
  }
  const result = await cdp(
    tabId,
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: writeClipboardInPage.toString(),
      arguments: [{ value: dataUrl }],
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    CLIPBOARD_TIMEOUT_MS,
  );

  if (result?.exceptionDetails || result?.result?.value !== true) {
    const message = result?.exceptionDetails?.exception?.description
      || result?.exceptionDetails?.text
      || "Chrome could not copy the PNG.";
    throw new Error(message);
  }
}

async function copyImageInFocusedPopup(dataUrl) {
  const token = `clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resultPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Chrome could not copy the PNG to the clipboard."));
    }, CLIPBOARD_TIMEOUT_MS * 4);

    function listener(message) {
      if (message?.type !== "BIGSHOOT_CLIPBOARD_RESULT" || message.token !== token) {
        return;
      }
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      if (message.ok) {
        resolve(true);
      } else {
        reject(new Error(message.error || "Chrome could not copy the PNG to the clipboard."));
      }
    }

    chrome.runtime.onMessage.addListener(listener);
  });

  clipboardPayloads.set(token, dataUrl);
  let popup;

  try {
    popup = await chrome.windows.create({
      url: `${chrome.runtime.getURL("src/clipboard.html")}#${encodeURIComponent(token)}`,
      type: "popup",
      focused: true,
      width: 160,
      height: 80,
    });
    await resultPromise;
  } finally {
    clipboardPayloads.delete(token);
    if (popup?.id) {
      await chrome.windows.remove(popup.id).catch(() => {});
    }
  }
}

async function writeClipboardInPage(dataUrl) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("The Clipboard API is unavailable on this page.");
  }
  const png = fetch(dataUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error("Chrome could not decode the captured PNG.");
    }
    return response.blob();
  });
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": png }),
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
