const DEFAULT_SETTINGS = Object.freeze({
  destination: "download",
  padding: 16,
});

const MENU_ID = "bigshoot-settings";
const OFFSCREEN_DOCUMENT = "src/offscreen/offscreen.html";

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(saved);

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

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isSupportedUrl(tab.url)) {
    await showBadgeError(tab.id, "Chrome does not allow extensions to capture this page.");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/picker.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "BIGSHOOT_START_PICKER" });
  } catch (error) {
    await showBadgeError(tab.id, normalizeError(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BIGSHOOT_CAPTURE_SELECTION") {
    return false;
  }

  captureSelection(sender.tab, message.mode)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));

  return true;
});

async function captureSelection(tab, mode) {
  if (!tab?.id || !tab.windowId) {
    throw new Error("The active capture tab could not be found.");
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  let debuggerAttached = false;
  let prepared = false;

  try {
    const preparation = await chrome.tabs.sendMessage(tab.id, {
      type: "BIGSHOOT_PREPARE_CAPTURE",
      mode,
      padding: settings.padding,
    });

    if (!preparation?.ok || !preparation.clip) {
      throw new Error(preparation?.error || "The capture region could not be measured.");
    }
    prepared = true;

    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    debuggerAttached = true;
    await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");

    const result = await chrome.debugger.sendCommand(
      { tabId: tab.id },
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: preparation.clip.x,
          y: preparation.clip.y,
          width: preparation.clip.width,
          height: preparation.clip.height,
          scale: 1,
        },
      },
    );

    if (!result?.data) {
      throw new Error("Chrome did not return screenshot data.");
    }

    const dataUrl = `data:image/png;base64,${result.data}`;
    const filename = buildFilename(tab.title, mode);

    if (settings.destination === "clipboard") {
      await copyImageToClipboard(dataUrl);
    } else {
      await chrome.downloads.download({
        url: dataUrl,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      });
    }

    await chrome.tabs.sendMessage(tab.id, {
      type: "BIGSHOOT_CAPTURE_COMPLETE",
      destination: settings.destination,
    });
  } catch (error) {
    await safeSend(tab.id, {
      type: "BIGSHOOT_CAPTURE_FAILED",
      error: humanizeCaptureError(error),
    });
    throw error;
  } finally {
    if (debuggerAttached) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
    if (prepared) {
      await safeSend(tab.id, { type: "BIGSHOOT_RESTORE_PAGE" });
    }
  }
}

async function copyImageToClipboard(dataUrl) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "BIGSHOOT_COPY_IMAGE",
    dataUrl,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The image could not be copied to the clipboard.");
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["CLIPBOARD"],
    justification: "Copy the PNG image the user just captured to the clipboard.",
  });
}

function isSupportedUrl(url = "") {
  return /^(https?|file):/i.test(url);
}

function buildFilename(title = "page", mode = "element") {
  const safeTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = mode === "page" ? "full-page" : "element";

  return `Bigshoot/${safeTitle || "page"}-${suffix}-${stamp}.png`;
}

async function safeSend(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The page may have navigated while the screenshot was being created.
  }
}

async function showBadgeError(tabId, message) {
  if (!tabId) {
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d74b3f" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title: `Bigshoot: ${message}` });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: "Select an element to capture" }).catch(() => {});
  }, 4000);
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
