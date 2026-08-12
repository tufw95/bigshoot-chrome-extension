const DEFAULT_SETTINGS = Object.freeze({
  destination: "download",
  padding: 16,
});

const MENU_ID = "bigshoot-settings";

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
  let captureError = null;

  try {
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    debuggerAttached = true;
    await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");
    await waitForStableViewport(tab.id);

    const plan = await chrome.tabs.sendMessage(tab.id, {
      type: "BIGSHOOT_PREPARE_CAPTURE",
      mode,
      padding: settings.padding,
    });

    if (!plan?.ok || !plan.kind) {
      throw new Error(plan?.error || "The capture region could not be measured.");
    }
    let dataUrl;
    if (plan.kind === "cdp") {
      dataUrl = await captureCdpClip(tab.id, plan.clip);
    } else if (plan.kind === "stitched") {
      dataUrl = await captureAndStitch(tab.id, plan);
    } else {
      throw new Error("The page returned an unsupported capture plan.");
    }

    const filename = buildFilename(tab.title, mode);
    if (settings.destination === "clipboard") {
      await copyImageToClipboard(tab.id, dataUrl);
    } else {
      await chrome.downloads.download({
        url: dataUrl,
        filename,
        conflictAction: "uniquify",
      });
    }
  } catch (error) {
    captureError = error;
  } finally {
    // Preparation may fail after the page has already been changed, so cleanup is unconditional.
    await safeSend(tab.id, { type: "BIGSHOOT_RESTORE_PAGE" });
    if (debuggerAttached) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
  }

  if (captureError) {
    await safeSend(tab.id, {
      type: "BIGSHOOT_CAPTURE_FAILED",
      error: humanizeCaptureError(captureError),
    });
    throw captureError;
  }

  await safeSend(tab.id, {
    type: "BIGSHOOT_CAPTURE_COMPLETE",
    destination: settings.destination,
  });
}

async function waitForStableViewport(tabId) {
  let previous = null;
  let stableSamples = 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const metrics = await chrome.debugger.sendCommand(
      { tabId },
      "Page.getLayoutMetrics",
    );
    const viewport = metrics?.cssVisualViewport;
    const current = viewport
      ? `${viewport.clientWidth}:${viewport.clientHeight}:${viewport.pageX}:${viewport.pageY}`
      : "unknown";

    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) {
      return;
    }
    previous = current;
    await delay(100);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureCdpClip(tabId, clip) {
  const normalizedClip = sanitizeClip(clip);
  const result = await chrome.debugger.sendCommand(
    { tabId },
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        ...normalizedClip,
        scale: 1,
      },
    },
  );

  if (!result?.data) {
    throw new Error("Chrome did not return screenshot data.");
  }
  return `data:image/png;base64,${result.data}`;
}

async function captureAndStitch(tabId, plan) {
  const firstFrame = await captureViewport(tabId);
  const firstPng = readPngDimensions(firstFrame.data);
  const firstCrop = await readFrameCrop(tabId, plan.sessionId, 0, firstPng);
  const outputWidth = firstCrop.crop.width;
  const expectedOutputHeight = firstCrop.outputHeight;
  const frameScale = firstCrop.scale;

  const frames = [{ data: firstFrame.data, crop: firstCrop.crop }];
  let capturedHeight = firstCrop.crop.height;

  let done = firstCrop.done;
  for (let frameIndex = 1; !done; frameIndex += 1) {
    const step = await chrome.tabs.sendMessage(tabId, {
      type: "BIGSHOOT_ADVANCE_CAPTURE",
      sessionId: plan.sessionId,
      frameIndex,
    });
    if (!step?.ok) {
      throw new Error(step?.error || "The page could not advance to the next screenshot frame.");
    }

    const frame = await captureViewport(tabId);
    const dimensions = readPngDimensions(frame.data);
    const frameCrop = await readFrameCrop(tabId, plan.sessionId, frameIndex, dimensions);
    if (frameCrop.scale !== frameScale) {
      throw new Error("The browser display scale changed during capture.");
    }
    frames.push({ data: frame.data, crop: frameCrop.crop });
    capturedHeight += frameCrop.crop.height;
    done = frameCrop.done;

    if (done) {
      break;
    }
    if (frameIndex >= 199) {
      throw new Error("The capture exceeded the 200-frame safety limit.");
    }
  }

  if (Math.abs(capturedHeight - expectedOutputHeight) > 2) {
    throw new Error(
      `The stitched screenshot geometry changed (${capturedHeight}/${expectedOutputHeight}px).`,
    );
  }

  assertCanvasSize(outputWidth, expectedOutputHeight);
  const canvas = new OffscreenCanvas(outputWidth, expectedOutputHeight);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Chrome could not create the screenshot canvas.");
  }
  let destinationY = 0;
  for (const frame of frames) {
    destinationY += await drawFrame(context, frame.data, frame.crop, destinationY);
  }
  if (destinationY !== expectedOutputHeight) {
    throw new Error(`The stitched screenshot ended at ${destinationY}/${expectedOutputHeight}px.`);
  }
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function captureViewport(tabId) {
  const result = await chrome.debugger.sendCommand(
    { tabId },
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    },
  );
  if (!result?.data) {
    throw new Error("Chrome did not return screenshot frame data.");
  }
  return result;
}

async function readFrameCrop(tabId, sessionId, frameIndex, dimensions) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "BIGSHOOT_READ_CAPTURE_FRAME",
    sessionId,
    frameIndex,
    bitmapWidth: dimensions.width,
    bitmapHeight: dimensions.height,
  });
  if (!response?.ok || !response.crop) {
    throw new Error(response?.error || "The screenshot frame could not be measured.");
  }
  return response;
}

async function drawFrame(context, base64, crop, destinationY) {
  const bitmap = await createImageBitmap(base64ToBlob(base64, "image/png"));
  try {
    const normalized = sanitizeBitmapCrop(crop, bitmap.width, bitmap.height);
    const remainingHeight = context.canvas.height - destinationY;
    if (normalized.height > remainingHeight + 1) {
      throw new Error("A screenshot frame exceeds the remaining output height.");
    }
    const drawHeight = Math.min(normalized.height, remainingHeight);
    context.drawImage(
      bitmap,
      normalized.x,
      normalized.y,
      normalized.width,
      drawHeight,
      0,
      destinationY,
      normalized.width,
      drawHeight,
    );
    return drawHeight;
  } finally {
    bitmap.close();
  }
}

function sanitizeBitmapCrop(crop, bitmapWidth, bitmapHeight) {
  const x = Math.round(Number(crop.x));
  const y = Math.round(Number(crop.y));
  const width = Math.round(Number(crop.width));
  const height = Math.round(Number(crop.height));

  if (
    ![x, y, width, height].every(Number.isFinite)
    || x < 0
    || y < 0
    || width < 1
    || height < 1
    || x + width > bitmapWidth
    || y + height > bitmapHeight
  ) {
    throw new Error(
      `The frame crop ${x},${y},${width}x${height} exceeds ${bitmapWidth}x${bitmapHeight}.`,
    );
  }
  return { x, y, width, height };
}

function assertCanvasSize(width, height) {
  const maxDimension = 32767;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > maxDimension
    || height > maxDimension
  ) {
    throw new Error(`The screenshot size ${width}x${height} exceeds Chrome's safe canvas limit.`);
  }
}

function readPngDimensions(base64) {
  const binary = atob(base64.slice(0, 40));
  if (binary.length < 24 || binary.slice(1, 4) !== "PNG") {
    throw new Error("Chrome returned an invalid PNG screenshot.");
  }
  return {
    width: readUint32(binary, 16),
    height: readUint32(binary, 20),
  };
}

function readUint32(binary, offset) {
  return (
    binary.charCodeAt(offset) * 0x1000000
    + binary.charCodeAt(offset + 1) * 0x10000
    + binary.charCodeAt(offset + 2) * 0x100
    + binary.charCodeAt(offset + 3)
  );
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function sanitizeClip(clip) {
  const x = Number(clip?.x);
  const y = Number(clip?.y);
  const width = Number(clip?.width);
  const height = Number(clip?.height);
  const maxDimension = 32767;
  if (
    ![x, y, width, height].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || width > maxDimension
    || height > maxDimension
  ) {
    throw new Error("The capture clip is outside Chrome's supported size.");
  }
  return { x, y, width, height };
}

async function copyImageToClipboard(tabId, dataUrl) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "BIGSHOOT_COPY_IMAGE",
    dataUrl,
  });

  if (!response?.ok) {
    console.warn("Bigshoot clipboard write failed:", response?.error);
    throw new Error("Chrome could not copy the PNG. Keep this tab active and try again.");
  }
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
  const suffix = mode === "page"
    ? "full-page"
    : mode === "surface"
      ? "full-window"
      : "element";

  return `${safeTitle || "page"}-${suffix}-${stamp}.png`;
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
