(() => {
  const GLOBAL_KEY = "__bigshootPicker";

  if (window[GLOBAL_KEY]) {
    return;
  }

  const state = {
    active: false,
    candidate: null,
    selected: null,
    mode: "element",
    restoreEntries: [],
    restoreScrollEntries: [],
    lastPointerTarget: null,
  };

  const ui = createUi();
  const api = { start, stop };
  window[GLOBAL_KEY] = api;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BIGSHOOT_START_PICKER") {
      start();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BIGSHOOT_PREPARE_CAPTURE") {
      prepareCapture(message.mode, message.padding)
        .then((clip) => sendResponse({ ok: true, clip }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "BIGSHOOT_RESTORE_PAGE") {
      restorePage();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BIGSHOOT_COPY_IMAGE") {
      copyImageToClipboard(message.dataUrl)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "BIGSHOOT_CAPTURE_COMPLETE") {
      const text = message.destination === "clipboard"
        ? "Image copied to the clipboard"
        : "Image saved to Downloads";
      showToast(text, "success");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BIGSHOOT_CAPTURE_FAILED") {
      restorePage();
      showToast(message.error || "This region could not be captured", "error");
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  function start() {
    if (state.active) {
      stop();
      return;
    }

    restorePage();
    state.active = true;
    state.candidate = null;
    state.selected = null;
    state.mode = "element";
    document.documentElement.dataset.bigshootPicking = "true";
    ui.host.hidden = false;
    ui.help.hidden = false;
    ui.focus.hidden = true;

    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", blockClick, true);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function stop() {
    state.active = false;
    state.candidate = null;
    delete document.documentElement.dataset.bigshootPicking;
    ui.focus.hidden = true;
    ui.help.hidden = true;

    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", blockClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
  }

  function onPointerMove(event) {
    if (!state.active) {
      return;
    }

    const target = getSelectableTarget(event);
    if (!target || target === state.candidate) {
      return;
    }

    state.lastPointerTarget = target;
    setCandidate(target);
  }

  function onPointerDown(event) {
    if (!state.active || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextClick();

    const target = getSelectableTarget(event) || state.candidate;
    if (!target) {
      return;
    }

    state.selected = target;
    state.mode = isFullPageTarget(target) ? "page" : "element";
    beginCapture();
  }

  function suppressNextClick() {
    const suppress = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("click", suppress, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", suppress, true), 1000);
  }

  function blockClick(event) {
    if (!state.active) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeyDown(event) {
    if (!state.active) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      stop();
      showToast("Capture canceled", "neutral");
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      const surface = findActiveCaptureSurface();
      state.selected = surface || document.documentElement;
      state.mode = surface ? "surface" : "page";
      beginCapture();
      return;
    }

    if (event.key === "ArrowUp" && state.candidate?.parentElement) {
      event.preventDefault();
      setCandidate(state.candidate.parentElement);
    }
  }

  function beginCapture() {
    stop();
    showToast("Capturing...", "working", 12000);
    chrome.runtime.sendMessage({
      type: "BIGSHOOT_CAPTURE_SELECTION",
      mode: state.mode,
    }).catch((error) => {
      showToast(error.message || "The capture could not be started", "error");
    });
  }

  function setCandidate(target) {
    state.candidate = target;
    const rect = target.getBoundingClientRect();
    const fullPage = isFullPageTarget(target);
    const scrollable = !fullPage && isScrollable(target);
    const name = fullPage ? "FULL PAGE" : describeElement(target);
    const width = fullPage ? getDocumentSize().width : Math.round(Math.max(rect.width, target.scrollWidth));
    const height = fullPage ? getDocumentSize().height : Math.round(Math.max(rect.height, target.scrollHeight));

    positionFocus(rect, fullPage);
    ui.label.textContent = name;
    ui.meta.textContent = `${width} x ${height}${scrollable ? " - scrollable" : ""}`;
  }

  function positionFocus(rect, fullPage) {
    const x = fullPage ? 0 : Math.max(0, rect.left);
    const y = fullPage ? 0 : Math.max(0, rect.top);
    const width = fullPage ? window.innerWidth : Math.min(window.innerWidth - x, rect.width);
    const height = fullPage ? window.innerHeight : Math.min(window.innerHeight - y, rect.height);
    const labelAbove = y > 44;

    ui.focus.hidden = false;
    ui.focus.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ui.focus.style.width = `${Math.max(0, width)}px`;
    ui.focus.style.height = `${Math.max(0, height)}px`;
    ui.badge.dataset.position = labelAbove ? "above" : "below";
  }

  async function prepareCapture(mode, paddingInput) {
    if (!state.selected && mode !== "page") {
      throw new Error("The selected element no longer exists.");
    }

    hideExtensionUi();
    const padding = clamp(Number(paddingInput) || 0, 0, 64);

    if (mode === "page") {
      await waitForPaint();
      const size = getDocumentSize();
      return sanitizeClip({ x: 0, y: 0, width: size.width, height: size.height });
    }

    const element = state.selected;
    if (!element.isConnected) {
      throw new Error("The selected element changed before it could be captured.");
    }

    if (mode === "surface") {
      return prepareSurfaceCapture(element);
    }

    expandScrollableElement(element);
    revealClippedAncestors(element);
    await waitForPaint();

    const rect = element.getBoundingClientRect();
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    const documentSize = getDocumentSize();
    const left = clamp(rect.left + pageX - padding, 0, documentSize.width);
    const top = clamp(rect.top + pageY - padding, 0, documentSize.height);
    const right = clamp(rect.right + pageX + padding, left + 1, documentSize.width);
    const bottom = clamp(rect.bottom + pageY + padding, top + 1, documentSize.height);

    return sanitizeClip({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }

  async function prepareSurfaceCapture(surface) {
    const initialRect = surface.getBoundingClientRect();
    const scrollRegion = findPrimaryScrollRegion(surface);

    if (scrollRegion) {
      rememberScrollPosition(scrollRegion);
      scrollRegion.scrollTop = 0;
      scrollRegion.scrollLeft = 0;
      expandSurfaceScrollRegion(scrollRegion, surface);
    }

    expandSurfaceRoot(surface, initialRect);
    await waitForPaint();

    const rect = surface.getBoundingClientRect();
    const width = Math.max(rect.width, surface.scrollWidth);
    const height = Math.max(rect.height, surface.scrollHeight);

    return sanitizeClip({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width,
      height,
    });
  }

  function expandSurfaceScrollRegion(scrollRegion, surface) {
    const height = Math.max(scrollRegion.getBoundingClientRect().height, scrollRegion.scrollHeight);
    rememberStyles(scrollRegion, [
      "height",
      "min-height",
      "max-height",
      "overflow",
      "overflow-y",
      "contain",
      "flex",
      "flex-basis",
    ]);
    scrollRegion.style.setProperty("height", `${height}px`, "important");
    scrollRegion.style.setProperty("min-height", `${height}px`, "important");
    scrollRegion.style.setProperty("max-height", "none", "important");
    scrollRegion.style.setProperty("overflow", "visible", "important");
    scrollRegion.style.setProperty("overflow-y", "visible", "important");
    scrollRegion.style.setProperty("contain", "none", "important");
    scrollRegion.style.setProperty("flex", "0 0 auto", "important");

    let ancestor = scrollRegion.parentElement;
    while (ancestor && ancestor !== surface) {
      rememberStyles(ancestor, [
        "height",
        "min-height",
        "max-height",
        "overflow",
        "overflow-y",
        "contain",
      ]);
      ancestor.style.setProperty("height", "auto", "important");
      ancestor.style.setProperty("max-height", "none", "important");
      ancestor.style.setProperty("overflow", "visible", "important");
      ancestor.style.setProperty("overflow-y", "visible", "important");
      ancestor.style.setProperty("contain", "none", "important");
      ancestor = ancestor.parentElement;
    }
  }

  function expandSurfaceRoot(surface, initialRect) {
    const captureTop = Math.max(0, initialRect.top + window.scrollY);
    const captureLeft = Math.max(0, initialRect.left + window.scrollX);
    rememberStyles(surface, [
      "position",
      "top",
      "right",
      "bottom",
      "left",
      "width",
      "height",
      "min-height",
      "max-height",
      "overflow",
      "overflow-x",
      "overflow-y",
      "contain",
      "transform",
      "transition",
    ]);

    surface.style.setProperty("position", "absolute", "important");
    surface.style.setProperty("top", `${captureTop}px`, "important");
    surface.style.setProperty("right", "auto", "important");
    surface.style.setProperty("bottom", "auto", "important");
    surface.style.setProperty("left", `${captureLeft}px`, "important");
    surface.style.setProperty("width", `${initialRect.width}px`, "important");
    surface.style.setProperty("height", "auto", "important");
    surface.style.setProperty("min-height", `${initialRect.height}px`, "important");
    surface.style.setProperty("max-height", "none", "important");
    surface.style.setProperty("overflow", "visible", "important");
    surface.style.setProperty("contain", "none", "important");
    surface.style.setProperty("transform", "none", "important");
    surface.style.setProperty("transition", "none", "important");
  }

  function expandScrollableElement(element) {
    if (!isScrollable(element)) {
      return;
    }

    rememberStyles(element, [
      "height",
      "width",
      "max-height",
      "max-width",
      "overflow",
      "overflow-x",
      "overflow-y",
      "contain",
    ]);

    const rect = element.getBoundingClientRect();
    element.style.setProperty("height", `${Math.max(rect.height, element.scrollHeight)}px`, "important");
    element.style.setProperty("width", `${Math.max(rect.width, element.scrollWidth)}px`, "important");
    element.style.setProperty("max-height", "none", "important");
    element.style.setProperty("max-width", "none", "important");
    element.style.setProperty("overflow", "visible", "important");
    element.style.setProperty("contain", "none", "important");
  }

  function revealClippedAncestors(element) {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const style = getComputedStyle(ancestor);
      const clips = [style.overflow, style.overflowX, style.overflowY]
        .some((value) => ["hidden", "clip"].includes(value));

      if (clips) {
        rememberStyles(ancestor, ["overflow", "overflow-x", "overflow-y"]);
        ancestor.style.setProperty("overflow", "visible", "important");
      }
      ancestor = ancestor.parentElement;
    }
  }

  function rememberStyles(element, properties) {
    const values = properties.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    }));
    state.restoreEntries.push({ element, values });
  }

  function rememberScrollPosition(element) {
    if (state.restoreScrollEntries.some((entry) => entry.element === element)) {
      return;
    }
    state.restoreScrollEntries.push({
      element,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    });
  }

  function restorePage() {
    for (const entry of state.restoreEntries.reverse()) {
      if (!entry.element?.isConnected) {
        continue;
      }
      for (const style of entry.values) {
        if (style.value) {
          entry.element.style.setProperty(style.property, style.value, style.priority);
        } else {
          entry.element.style.removeProperty(style.property);
        }
      }
    }
    state.restoreEntries = [];
    for (const entry of state.restoreScrollEntries) {
      if (entry.element?.isConnected) {
        entry.element.scrollTop = entry.scrollTop;
        entry.element.scrollLeft = entry.scrollLeft;
      }
    }
    state.restoreScrollEntries = [];
    showExtensionUi();
  }

  function getSelectableTarget(event) {
    const path = event.composedPath?.() || [];
    const target = path.find((node) => node instanceof HTMLElement && node !== ui.host);
    if (!target || ui.host.contains(target)) {
      return null;
    }
    return target;
  }

  function isFullPageTarget(element) {
    if (element === document.documentElement || element === document.body) {
      return true;
    }

    const rect = element.getBoundingClientRect();
    const nearRoot = element.parentElement === document.body;
    const coversViewport = rect.width >= window.innerWidth * 0.94
      && rect.height >= window.innerHeight * 0.94;
    const coversDocument = element.scrollHeight >= getDocumentSize().height * 0.94;
    return nearRoot && coversViewport && coversDocument;
  }

  function isScrollable(element) {
    const style = getComputedStyle(element);
    const vertical = element.scrollHeight > element.clientHeight + 1
      && /(auto|scroll|overlay|hidden)/.test(style.overflowY);
    const horizontal = element.scrollWidth > element.clientWidth + 1
      && /(auto|scroll|overlay|hidden)/.test(style.overflowX);
    return vertical || horizontal;
  }

  function findActiveCaptureSurface() {
    const selector = [
      "dialog[open]",
      "[aria-modal='true']",
      "[role='dialog']",
      "[data-state='open']",
      "[data-open='true']",
      "[class*='modal']",
      "[class*='drawer']",
      "[class*='sheet']",
    ].join(",");
    const candidates = new Set();

    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement) || !isActiveSurfaceElement(element)) {
        continue;
      }
      candidates.add(getSurfaceRoot(element));
    }

    return [...candidates]
      .map((element) => ({ element, score: scoreCaptureSurface(element) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function isActiveSurfaceElement(element) {
    if (!isVisible(element)) {
      return false;
    }

    if (element.matches("dialog[open], [aria-modal='true'], [data-state='open'], [data-open='true']")) {
      return true;
    }

    const signals = `${element.id} ${element.className}`.toLowerCase();
    return element.getAttribute("role") === "dialog"
      || /(?:^|[\s_-])(open|opened|show|shown|active|visible|drawer-on)(?:$|[\s_-])/.test(signals);
  }

  function getSurfaceRoot(element) {
    if (element.matches("dialog, [role='dialog'], [aria-modal='true']")) {
      return element;
    }

    let root = element;
    let ancestor = element.parentElement;

    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const containsRoot = rect.left <= rootRect.left + 2
        && rect.top <= rootRect.top + 2
        && rect.right >= rootRect.right - 2
        && rect.bottom >= rootRect.bottom - 2;

      if (containsRoot && ["fixed", "sticky"].includes(style.position)) {
        root = ancestor;
      }
      ancestor = ancestor.parentElement;
    }

    return root;
  }

  function scoreCaptureSurface(element) {
    if (!isVisible(element) || element === document.body || element === document.documentElement) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    const viewportArea = window.innerWidth * window.innerHeight;
    if (visibleArea < viewportArea * 0.12) {
      return 0;
    }

    const scrollRegion = findPrimaryScrollRegion(element);
    if (!scrollRegion) {
      return 0;
    }

    const style = getComputedStyle(element);
    const zIndex = Number.parseInt(style.zIndex, 10) || 0;
    const hiddenHeight = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
    const semantics = element.matches("dialog, [role='dialog'], [aria-modal='true']") ? viewportArea : 0;
    return visibleArea + hiddenHeight * Math.max(1, scrollRegion.clientWidth) + semantics + zIndex * 100;
  }

  function findPrimaryScrollRegion(surface) {
    const regions = [surface, ...surface.querySelectorAll("*")]
      .filter((element) => element instanceof HTMLElement && isScrollable(element));

    return regions.sort((a, b) => scoreScrollRegion(b) - scoreScrollRegion(a))[0] || null;
  }

  function scoreScrollRegion(element) {
    const rect = element.getBoundingClientRect();
    const hiddenHeight = Math.max(0, element.scrollHeight - element.clientHeight);
    const hiddenWidth = Math.max(0, element.scrollWidth - element.clientWidth);
    return hiddenHeight * Math.max(1, rect.width) + hiddenWidth * Math.max(1, rect.height);
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number.parseFloat(style.opacity || "1") > 0
      && rect.width > 1
      && rect.height > 1
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${element.id}`;
    }
    const classes = [...element.classList]
      .filter((name) => name && !/^css-|^jsx-/.test(name))
      .slice(0, 2);
    return classes.length ? `${tag}.${classes.join(".")}` : tag;
  }

  function getDocumentSize() {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(
        root.scrollWidth,
        root.offsetWidth,
        root.clientWidth,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0,
      ),
      height: Math.max(
        root.scrollHeight,
        root.offsetHeight,
        root.clientHeight,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
      ),
    };
  }

  function sanitizeClip(clip) {
    const maxDimension = 32767;
    return {
      x: Math.max(0, Math.floor(clip.x)),
      y: Math.max(0, Math.floor(clip.y)),
      width: clamp(Math.ceil(clip.width), 1, maxDimension),
      height: clamp(Math.ceil(clip.height), 1, maxDimension),
    };
  }

  function hideExtensionUi() {
    ui.host.style.setProperty("display", "none", "important");
  }

  function showExtensionUi() {
    ui.host.style.removeProperty("display");
  }

  function showToast(text, tone, duration = 3200) {
    clearTimeout(ui.toastTimer);
    ui.toast.textContent = text;
    ui.toast.dataset.tone = tone;
    ui.toast.hidden = false;
    ui.host.hidden = false;
    ui.toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
      if (!state.active) {
        ui.host.hidden = true;
      }
    }, duration);
  }

  async function copyImageToClipboard(dataUrl) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("The Clipboard API is not available in this tab.");
    }

    const blob = dataUrlToBlob(dataUrl);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
  }

  function dataUrlToBlob(dataUrl) {
    const separator = dataUrl.indexOf(",");
    if (separator === -1) {
      throw new Error("The screenshot data is invalid.");
    }

    const metadata = dataUrl.slice(0, separator);
    const encoded = dataUrl.slice(separator + 1);
    const mimeType = metadata.match(/^data:([^;,]+)/)?.[1] || "image/png";
    const binary = metadata.includes(";base64")
      ? atob(encoded)
      : decodeURIComponent(encoded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = "bigshoot-extension-root";
    host.hidden = true;
    for (const [property, value] of Object.entries({
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      width: "0",
      height: "0",
      overflow: "visible",
      pointerEvents: "none",
    })) {
      host.style.setProperty(
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        value,
        "important",
      );
    }
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        width: 0;
        height: 0;
        overflow: visible;
        pointer-events: none;
      }
      :host([hidden]) { display: none; }
      * { box-sizing: border-box; }
      .focus {
        position: fixed;
        inset: 0 auto auto 0;
        z-index: 2147483646;
        border: 2px solid #14b8c8;
        background: rgba(20, 184, 200, 0.08);
        box-shadow: 0 0 0 99999px rgba(9, 20, 27, 0.18), 0 0 0 1px rgba(255,255,255,.9) inset;
        pointer-events: none;
        transition: width 60ms linear, height 60ms linear, transform 60ms linear;
      }
      .badge {
        position: absolute;
        left: -2px;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: min(460px, 90vw);
        padding: 7px 10px;
        color: #ecfeff;
        background: #09333a;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 7px;
        box-shadow: 0 8px 26px rgba(0, 20, 28, .24);
        font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: -.02em;
        white-space: nowrap;
      }
      .badge[data-position="above"] { bottom: calc(100% + 8px); }
      .badge[data-position="below"] { top: calc(100% + 8px); }
      .label { overflow: hidden; text-overflow: ellipsis; }
      .meta { color: #8ee7ef; font-weight: 500; }
      .help {
        position: fixed;
        z-index: 2147483647;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px 8px 13px;
        color: #173137;
        background: rgba(247, 252, 251, .96);
        border: 1px solid rgba(12, 63, 70, .14);
        border-radius: 999px;
        box-shadow: 0 12px 34px rgba(11, 35, 41, .18);
        backdrop-filter: blur(12px);
        font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        pointer-events: none;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        color: #fff;
        background: #0b7f8c;
        border-radius: 50%;
      }
      kbd {
        min-width: 23px;
        padding: 3px 6px;
        color: #31545a;
        background: #e5f0ef;
        border: 1px solid #c9dcda;
        border-bottom-width: 2px;
        border-radius: 5px;
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-align: center;
      }
      .toast {
        position: fixed;
        z-index: 2147483647;
        right: 20px;
        bottom: 20px;
        max-width: min(380px, calc(100vw - 40px));
        padding: 12px 15px;
        color: #f6fbfb;
        background: #173137;
        border-radius: 10px;
        box-shadow: 0 14px 40px rgba(5, 25, 31, .28);
        font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: enter 160ms ease-out both;
        pointer-events: none;
      }
      .toast[data-tone="success"] { background: #126b55; }
      .toast[data-tone="error"] { background: #a13a32; }
      .toast[data-tone="working"]::before {
        content: "";
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-right: 8px;
        border: 2px solid rgba(255,255,255,.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin .7s linear infinite;
      }
      [hidden] { display: none !important; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes enter { from { opacity: 0; transform: translateY(8px); } }
      @media (prefers-reduced-motion: reduce) {
        .focus, .toast { transition: none; animation: none; }
      }
    `;

    const focus = document.createElement("div");
    focus.className = "focus";
    focus.hidden = true;
    const badge = document.createElement("div");
    badge.className = "badge";
    const label = document.createElement("span");
    label.className = "label";
    const meta = document.createElement("span");
    meta.className = "meta";
    badge.append(label, meta);
    focus.append(badge);

    const help = document.createElement("div");
    help.className = "help";
    help.innerHTML = `
      <span class="mark" aria-hidden="true">⌖</span>
      <span>Click to capture</span>
      <kbd>F</kbd><span>Full page / window</span>
      <kbd>↑</kbd><span>Parent element</span>
      <kbd>Esc</kbd>
    `;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.hidden = true;

    shadow.append(style, focus, help, toast);
    document.documentElement.append(host);

    return { host, focus, badge, label, meta, help, toast, toastTimer: null };
  }
})();
