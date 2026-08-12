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
    document.addEventListener("keydown", onKeyDown, true);
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
    document.removeEventListener("keydown", onKeyDown, true);
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
      state.selected = document.documentElement;
      state.mode = "page";
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
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
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
      <kbd>F</kbd><span>Full page</span>
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
