(() => {
  const GLOBAL_KEY = "__bigshootPicker";
  const MAX_CAPTURE_FRAMES = 200;
  const VIEWPORT_TOLERANCE = 1;

  if (window[GLOBAL_KEY]) {
    return;
  }

  const state = {
    active: false,
    candidate: null,
    selected: null,
    mode: "element",
    capture: null,
  };

  const ui = createUi();
  window[GLOBAL_KEY] = { start, stop };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BIGSHOOT_START_PICKER") {
      start();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BIGSHOOT_PREPARE_CAPTURE") {
      prepareCapture(message.mode, message.padding)
        .then((plan) => sendResponse({ ok: true, ...plan }))
        .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
      return true;
    }

    if (message?.type === "BIGSHOOT_ADVANCE_CAPTURE") {
      advanceCapture(message.sessionId, message.frameIndex)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
      return true;
    }

    if (message?.type === "BIGSHOOT_READ_CAPTURE_FRAME") {
      readCaptureFrame(
        message.sessionId,
        message.frameIndex,
        message.bitmapWidth,
        message.bitmapHeight,
      )
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
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
        .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
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
    setCandidate(target);
  }

  function onPointerDown(event) {
    if (!state.active || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextClick();

    const target = state.candidate || getSelectableTarget(event);
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
    showToast("Capturing...", "working", 30000);
    chrome.runtime.sendMessage({
      type: "BIGSHOOT_CAPTURE_SELECTION",
      mode: state.mode,
    }).catch((error) => {
      showToast(normalizeError(error), "error");
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
    restorePage();
    hideExtensionUi();
    const padding = clamp(Number(paddingInput) || 0, 0, 64);

    if (mode === "page") {
      await waitForPaint();
      const size = getDocumentSize();
      return {
        kind: "cdp",
        clip: sanitizeDocumentClip({ x: 0, y: 0, width: size.width, height: size.height }),
      };
    }

    const element = state.selected;
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      throw new Error("The selected element changed before it could be captured.");
    }

    if (mode === "surface") {
      return prepareSurfaceCapture(element);
    }

    if (isSelfScrollable(element)) {
      return prepareScrollableElementCapture(element, padding);
    }

    await waitForPaint();
    const rect = element.getBoundingClientRect();
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    const documentSize = getDocumentSize();
    const left = clamp(rect.left + pageX - padding, 0, documentSize.width);
    const top = clamp(rect.top + pageY - padding, 0, documentSize.height);
    const right = clamp(rect.right + pageX + padding, left + 1, documentSize.width);
    const bottom = clamp(rect.bottom + pageY + padding, top + 1, documentSize.height);

    return {
      kind: "cdp",
      clip: sanitizeDocumentClip({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }),
    };
  }

  async function prepareScrollableElementCapture(element, padding) {
    const initialRect = toPlainRect(element.getBoundingClientRect());
    assertPaddedRectFullyVisible(initialRect, padding, "scrollable element");
    const originalScrollTop = element.scrollTop;
    const originalScrollLeft = element.scrollLeft;
    const originalScrollBehavior = element.style.getPropertyValue("scroll-behavior");
    const originalScrollBehaviorPriority = element.style.getPropertyPriority("scroll-behavior");
    const originalScrollSnapType = element.style.getPropertyValue("scroll-snap-type");
    const originalScrollSnapTypePriority = element.style.getPropertyPriority("scroll-snap-type");
    state.capture = {
      kind: "scroll-element",
      sessionId: createSessionId(),
      target: element,
      originalScrollTop,
      originalScrollLeft,
      originalScrollBehavior,
      originalScrollBehaviorPriority,
      originalScrollSnapType,
      originalScrollSnapTypePriority,
      frameIndex: 0,
      capturedCssHeight: 0,
      padding,
      geometry: null,
      borderInsets: null,
      repeatingEntries: [],
      knownScrollHeight: element.scrollHeight,
    };

    element.style.setProperty("scroll-behavior", "auto", "important");
    element.style.setProperty("scroll-snap-type", "none", "important");
    element.scrollTop = 0;
    element.scrollLeft = 0;
    hideScrollbars();
    hideOverlappingFixedElements(element);
    await waitForPaint();

    const geometry = readInnerGeometry(element);
    const borderRect = toPlainRect(element.getBoundingClientRect());
    assertPaddedRectFullyVisible(borderRect, padding, "scrollable element");
    state.capture.geometry = geometry;
    state.capture.borderInsets = {
      left: geometry.rect.left - borderRect.left,
      top: geometry.rect.top - borderRect.top,
      right: borderRect.right - geometry.rect.right,
      bottom: borderRect.bottom - geometry.rect.bottom,
    };
    state.capture.repeatingEntries = collectRepeatingEntries(element, geometry);

    return {
      kind: "stitched",
      sessionId: state.capture.sessionId,
    };
  }

  async function prepareSurfaceCapture(surface) {
    const scrollRegion = findPrimaryScrollRegion(surface);
    if (!scrollRegion) {
      await waitForPaint();
      const rect = surface.getBoundingClientRect();
      return {
        kind: "cdp",
        clip: sanitizeDocumentClip({
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        }),
      };
    }

    assertFullyVisible(surface.getBoundingClientRect(), "open window");
    const originalScrollTop = scrollRegion.scrollTop;
    const originalScrollLeft = scrollRegion.scrollLeft;
    const originalScrollBehavior = scrollRegion.style.getPropertyValue("scroll-behavior");
    const originalScrollBehaviorPriority = scrollRegion.style.getPropertyPriority("scroll-behavior");
    const originalScrollSnapType = scrollRegion.style.getPropertyValue("scroll-snap-type");
    const originalScrollSnapTypePriority = scrollRegion.style.getPropertyPriority("scroll-snap-type");
    state.capture = {
      kind: "surface",
      sessionId: createSessionId(),
      target: surface,
      scrollTarget: scrollRegion,
      originalScrollTop,
      originalScrollLeft,
      originalScrollBehavior,
      originalScrollBehaviorPriority,
      originalScrollSnapType,
      originalScrollSnapTypePriority,
      frameIndex: 0,
      capturedCssHeight: 0,
      surfaceRect: null,
      scrollGeometry: null,
      scrollVisualScale: 1,
      repeatingEntries: [],
      surfaceStaticEntries: [],
      surfaceStaticHidden: false,
      headerHeight: 0,
      footerHeight: 0,
      knownScrollHeight: scrollRegion.scrollHeight,
    };

    scrollRegion.style.setProperty("scroll-behavior", "auto", "important");
    scrollRegion.style.setProperty("scroll-snap-type", "none", "important");
    scrollRegion.scrollTop = 0;
    scrollRegion.scrollLeft = 0;
    hideScrollbars();
    hideOverlappingFixedElements(surface);
    await waitForPaint();

    const surfaceRect = toPlainRect(surface.getBoundingClientRect());
    const scrollGeometry = readInnerGeometry(scrollRegion);
    const scrollBorderRect = toPlainRect(scrollRegion.getBoundingClientRect());
    assertFullyVisible(surfaceRect, "open window");
    assertFullyVisible(scrollGeometry.rect, "open window content");
    if (
      scrollGeometry.rect.left < surfaceRect.left - VIEWPORT_TOLERANCE
      || scrollGeometry.rect.right > surfaceRect.right + VIEWPORT_TOLERANCE
      || scrollGeometry.rect.top < surfaceRect.top - VIEWPORT_TOLERANCE
      || scrollGeometry.rect.bottom > surfaceRect.bottom + VIEWPORT_TOLERANCE
    ) {
      throw new Error("The open window's scroll region is outside its visible bounds.");
    }

    state.capture.surfaceRect = surfaceRect;
    state.capture.scrollGeometry = scrollGeometry;
    state.capture.scrollVisualScale = scrollGeometry.scaleY;
    state.capture.repeatingEntries = collectRepeatingEntries(scrollRegion, scrollGeometry);
    state.capture.surfaceStaticEntries = collectSurfaceStaticEntries(
      surface,
      scrollRegion,
      scrollGeometry.rect,
    );
    state.capture.headerHeight = Math.max(0, scrollBorderRect.top - surfaceRect.top);
    state.capture.footerHeight = Math.max(0, surfaceRect.bottom - scrollBorderRect.bottom);

    return {
      kind: "stitched",
      sessionId: state.capture.sessionId,
    };
  }

  async function advanceCapture(sessionId, frameIndex) {
    const capture = requireCaptureSession(sessionId, frameIndex - 1);
    if (frameIndex >= MAX_CAPTURE_FRAMES) {
      throw new Error(`The capture exceeded the ${MAX_CAPTURE_FRAMES}-frame safety limit.`);
    }

    const scrollTarget = capture.kind === "surface" ? capture.scrollTarget : capture.target;
    if (!(scrollTarget instanceof HTMLElement) || !scrollTarget.isConnected) {
      throw new Error("The scrollable region changed during capture.");
    }

    capture.knownScrollHeight = Math.max(capture.knownScrollHeight, scrollTarget.scrollHeight);
    const maxScrollTop = Math.max(0, capture.knownScrollHeight - scrollTarget.clientHeight);
    const nextScrollTop = Math.min(
      maxScrollTop,
      capture.capturedCssHeight,
    );
    const previousScrollTop = scrollTarget.scrollTop;
    scrollTarget.scrollTop = nextScrollTop;
    await waitForPaint();

    const staticSurfaceChanged = capture.kind === "surface"
      && frameIndex === 1
      && hideSurfaceStaticEntries(capture);
    if (hidePreviouslyCapturedRepeatingElements(capture) || staticSurfaceChanged) {
      await waitForPaint();
    }

    capture.knownScrollHeight = Math.max(capture.knownScrollHeight, scrollTarget.scrollHeight);
    capture.frameIndex = frameIndex;
    if (
      scrollTarget.scrollTop <= previousScrollTop + VIEWPORT_TOLERANCE
      && capture.capturedCssHeight < capture.knownScrollHeight - VIEWPORT_TOLERANCE
    ) {
      throw new Error("The scrollable region did not reveal new content.");
    }
    return { scrollTop: scrollTarget.scrollTop };
  }

  async function readCaptureFrame(sessionId, frameIndex, bitmapWidth, bitmapHeight) {
    const capture = requireCaptureSession(sessionId, frameIndex);
    const dimensions = validateBitmapDimensions(bitmapWidth, bitmapHeight);
    const scale = readBitmapScale(dimensions);

    if (capture.kind === "scroll-element") {
      return { ...readScrollableElementFrame(capture, scale, dimensions), scale: scale.y };
    }
    if (capture.kind === "surface") {
      return { ...readSurfaceFrame(capture, scale, dimensions), scale: scale.y };
    }
    throw new Error("The active capture session is invalid.");
  }

  function readScrollableElementFrame(capture, scale, dimensions) {
    const element = capture.target;
    const currentGeometry = readInnerGeometry(element);
    const lockedRect = lockRectSize(currentGeometry.rect, capture.geometry.rect);
    assertFullyVisible(lockedRect, "scrollable element");

    capture.knownScrollHeight = Math.max(capture.knownScrollHeight, element.scrollHeight);
    const visibleEnd = Math.min(
      capture.knownScrollHeight,
      element.scrollTop + element.clientHeight,
    );
    const newCssHeight = Math.max(0, visibleEnd - capture.capturedCssHeight);
    if (newCssHeight <= VIEWPORT_TOLERANCE) {
      throw new Error("The screenshot frame did not contain new element content.");
    }

    const cropCssHeight = Math.min(element.clientHeight, newCssHeight) * capture.geometry.scaleY;
    const borderLeft = capture.borderInsets.left;
    const borderTop = capture.borderInsets.top;
    const borderRight = capture.borderInsets.right;
    const borderBottom = capture.borderInsets.bottom;
    const leftPadding = capture.padding;
    const rightPadding = capture.padding;
    const topPadding = capture.frameIndex === 0 ? capture.padding : 0;
    const bottomPadding = visibleEnd >= capture.knownScrollHeight - VIEWPORT_TOLERANCE
      ? capture.padding
      : 0;
    const left = lockedRect.left - borderLeft - leftPadding;
    const right = lockedRect.right + borderRight + rightPadding;
    const topBorder = capture.frameIndex === 0 ? borderTop : 0;
    const bottomBorder = visibleEnd >= capture.knownScrollHeight - VIEWPORT_TOLERANCE
      ? borderBottom
      : 0;
    const sliceRect = {
      left,
      top: lockedRect.bottom - cropCssHeight - topBorder - topPadding,
      right,
      bottom: lockedRect.bottom + bottomBorder + bottomPadding,
      width: right - left,
      height: cropCssHeight + topBorder + bottomBorder + topPadding + bottomPadding,
    };
    const crop = cssRectToBitmapRect(sliceRect, scale, dimensions);
    capture.capturedCssHeight = visibleEnd;
    const done = visibleEnd >= capture.knownScrollHeight - VIEWPORT_TOLERANCE;
    return {
      crop,
      outputHeight: Math.round(
        (
          capture.knownScrollHeight * capture.geometry.scaleY
          + borderTop
          + borderBottom
          + capture.padding * 2
        ) * scale.y,
      ),
      done,
    };
  }

  function readSurfaceFrame(capture, scale, dimensions) {
    const surfaceRect = lockRectSize(
      toPlainRect(capture.target.getBoundingClientRect()),
      capture.surfaceRect,
    );
    const currentScrollGeometry = readInnerGeometry(capture.scrollTarget);
    const scrollRect = lockRectSize(currentScrollGeometry.rect, capture.scrollGeometry.rect);
    assertFullyVisible(surfaceRect, "open window");
    assertFullyVisible(scrollRect, "open window content");

    capture.knownScrollHeight = Math.max(capture.knownScrollHeight, capture.scrollTarget.scrollHeight);
    const visibleEnd = Math.min(
      capture.knownScrollHeight,
      capture.scrollTarget.scrollTop + capture.scrollTarget.clientHeight,
    );
    const newCssHeight = Math.max(0, visibleEnd - capture.capturedCssHeight);
    if (newCssHeight <= VIEWPORT_TOLERANCE) {
      throw new Error("The screenshot frame did not contain new window content.");
    }

    let sliceRect;
    if (capture.frameIndex === 0) {
      sliceRect = {
        left: surfaceRect.left,
        top: surfaceRect.top,
        right: surfaceRect.right,
        bottom: scrollRect.bottom,
        width: surfaceRect.width,
        height: scrollRect.bottom - surfaceRect.top,
      };
    } else {
      const cropCssHeight = Math.min(capture.scrollTarget.clientHeight, newCssHeight)
        * capture.scrollVisualScale;
      sliceRect = {
        left: surfaceRect.left,
        top: scrollRect.bottom - cropCssHeight,
        right: surfaceRect.right,
        bottom: scrollRect.bottom,
        width: surfaceRect.width,
        height: cropCssHeight,
      };
    }

    const done = visibleEnd >= capture.knownScrollHeight - VIEWPORT_TOLERANCE;
    if (done && capture.footerHeight > 0) {
      sliceRect.bottom = surfaceRect.bottom;
      sliceRect.height = sliceRect.bottom - sliceRect.top;
    }

    const crop = cssRectToBitmapRect(sliceRect, scale, dimensions);
    capture.capturedCssHeight = visibleEnd;
    return {
      crop,
      outputHeight: Math.round(
        (
          capture.headerHeight
          + capture.knownScrollHeight * capture.scrollVisualScale
          + capture.footerHeight
        ) * scale.y,
      ),
      done,
    };
  }

  function requireCaptureSession(sessionId, frameIndex) {
    const capture = state.capture;
    if (!capture || capture.sessionId !== sessionId) {
      throw new Error("The capture session expired. Please select the element again.");
    }
    if (capture.frameIndex !== frameIndex) {
      throw new Error("The screenshot frames arrived out of order.");
    }
    return capture;
  }

  function readBitmapScale(dimensions) {
    if (window.innerWidth <= 0 || window.innerHeight <= 0) {
      throw new Error("The browser viewport is unavailable.");
    }
    return {
      x: dimensions.width / window.innerWidth,
      y: dimensions.height / window.innerHeight,
    };
  }

  function cssRectToBitmapRect(rect, scale, dimensions) {
    const viewport = window.visualViewport;
    const visualScale = viewport?.scale || 1;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    const left = (rect.left - offsetLeft) * visualScale * scale.x;
    const top = (rect.top - offsetTop) * visualScale * scale.y;
    const right = (rect.right - offsetLeft) * visualScale * scale.x;
    const bottom = (rect.bottom - offsetTop) * visualScale * scale.y;
    const x = clamp(Math.round(left), 0, dimensions.width - 1);
    const y = clamp(Math.round(top), 0, dimensions.height - 1);
    const cropRight = clamp(Math.round(right), x + 1, dimensions.width);
    const cropBottom = clamp(Math.round(bottom), y + 1, dimensions.height);
    return {
      x,
      y,
      width: cropRight - x,
      height: cropBottom - y,
    };
  }

  function validateBitmapDimensions(widthInput, heightInput) {
    const width = Math.round(Number(widthInput));
    const height = Math.round(Number(heightInput));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error("Chrome returned invalid screenshot dimensions.");
    }
    return { width, height };
  }

  function hideScrollbars() {
    const style = document.createElement("style");
    style.dataset.bigshootTemporary = "scrollbars";
    style.textContent = `
      html, body, * { scrollbar-color: transparent transparent !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
        background: transparent !important;
      }
      html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb,
      html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, *::-webkit-scrollbar-track {
        background: transparent !important;
        border-color: transparent !important;
      }
    `;
    document.documentElement.append(style);
  }

  function hideOverlappingFixedElements(target) {
    const targetRect = target.getBoundingClientRect();
    for (const element of document.querySelectorAll("body *")) {
      if (!(element instanceof HTMLElement) || element === target) {
        continue;
      }
      if (target.contains(element) || element.contains(target) || ui.host.contains(element)) {
        continue;
      }
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (!rectsOverlap(rect, targetRect) || !isVisible(element)) {
        continue;
      }
      hideElementTemporarily(element);
    }
  }

  function collectRepeatingEntries(scrollTarget, geometry) {
    const entries = [];
    for (const element of scrollTarget.querySelectorAll("*")) {
      const position = element instanceof HTMLElement ? getComputedStyle(element).position : "";
      if (!['fixed', 'sticky'].includes(position)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      entries.push({
        element,
        contentOffset: Math.max(
          0,
          (rect.top - geometry.rect.top) / Math.max(geometry.scaleY, Number.EPSILON)
            + scrollTarget.scrollTop,
        ),
        value: element.style.getPropertyValue("visibility"),
        priority: element.style.getPropertyPriority("visibility"),
        hidden: false,
      });
    }
    return entries;
  }

  function collectSurfaceStaticEntries(surface, scrollTarget, scrollRect) {
    const entries = [];
    let branch = scrollTarget;

    while (branch && branch !== surface) {
      const parent = branch.parentElement;
      if (!parent) {
        break;
      }
      for (const sibling of parent.children) {
        if (
          sibling instanceof HTMLElement
          && sibling !== branch
          && isVisible(sibling)
          && rectsOverlapVertically(sibling.getBoundingClientRect(), scrollRect)
        ) {
          entries.push(sibling);
        }
      }
      branch = parent;
    }
    return entries;
  }

  function hideSurfaceStaticEntries(capture) {
    if (capture.surfaceStaticHidden) {
      return false;
    }
    capture.surfaceStaticHidden = true;
    for (const element of capture.surfaceStaticEntries) {
      hideElementTemporarily(element);
    }
    return capture.surfaceStaticEntries.length > 0;
  }

  function hidePreviouslyCapturedRepeatingElements(capture) {
    let changed = false;
    for (const entry of capture.repeatingEntries || []) {
      if (
        entry.hidden
        || !entry.element.isConnected
        || entry.contentOffset >= capture.capturedCssHeight - VIEWPORT_TOLERANCE
      ) {
        continue;
      }
      entry.element.style.setProperty("visibility", "hidden", "important");
      entry.hidden = true;
      changed = true;
    }
    return changed;
  }

  function restoreRepeatingEntries(capture) {
    for (const entry of capture?.repeatingEntries || []) {
      if (!entry.hidden || !entry.element.isConnected) {
        continue;
      }
      if (entry.value) {
        entry.element.style.setProperty("visibility", entry.value, entry.priority);
      } else {
        entry.element.style.removeProperty("visibility");
      }
    }
  }

  function hideElementTemporarily(element) {
    if (element.dataset.bigshootTemporaryHidden === "true") {
      return;
    }
    element.dataset.bigshootPreviousVisibility = element.style.getPropertyValue("visibility");
    element.dataset.bigshootPreviousVisibilityPriority = element.style.getPropertyPriority("visibility");
    element.dataset.bigshootTemporaryHidden = "true";
    element.style.setProperty("visibility", "hidden", "important");
  }

  function restorePage() {
    const capture = state.capture;
    if (capture) {
      const scrollTarget = capture.kind === "surface" ? capture.scrollTarget : capture.target;
      if (scrollTarget instanceof HTMLElement && scrollTarget.isConnected) {
        scrollTarget.scrollTop = capture.originalScrollTop;
        scrollTarget.scrollLeft = capture.originalScrollLeft;
        restoreInlineProperty(
          scrollTarget,
          "scroll-behavior",
          capture.originalScrollBehavior,
          capture.originalScrollBehaviorPriority,
        );
        restoreInlineProperty(
          scrollTarget,
          "scroll-snap-type",
          capture.originalScrollSnapType,
          capture.originalScrollSnapTypePriority,
        );
      }
      restoreRepeatingEntries(capture);
    }
    state.capture = null;

    for (const element of document.querySelectorAll("[data-bigshoot-temporary-hidden='true']")) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const value = element.dataset.bigshootPreviousVisibility || "";
      const priority = element.dataset.bigshootPreviousVisibilityPriority || "";
      if (value) {
        element.style.setProperty("visibility", value, priority);
      } else {
        element.style.removeProperty("visibility");
      }
      delete element.dataset.bigshootPreviousVisibility;
      delete element.dataset.bigshootPreviousVisibilityPriority;
      delete element.dataset.bigshootTemporaryHidden;
    }

    for (const style of document.querySelectorAll("style[data-bigshoot-temporary='scrollbars']")) {
      style.remove();
    }
    showExtensionUi();
  }

  function restoreInlineProperty(element, property, value, priority) {
    if (value) {
      element.style.setProperty(property, value, priority);
    } else {
      element.style.removeProperty(property);
    }
  }

  function getSelectableTarget(event) {
    const path = event.composedPath?.() || [];
    const elements = path.filter((node) => node instanceof HTMLElement && node !== ui.host);
    const exact = elements[0];
    const scrollable = elements.find((node) => isSelfScrollable(node));
    const target = scrollable && shouldPreferScrollableAncestor(exact, scrollable)
      ? scrollable
      : exact;
    if (!target || ui.host.contains(target)) {
      return null;
    }
    return target;
  }

  function shouldPreferScrollableAncestor(exact, scrollable) {
    if (!exact || exact === scrollable) {
      return true;
    }
    const rect = scrollable.getBoundingClientRect();
    const hiddenHeight = scrollable.scrollHeight - scrollable.clientHeight;
    return hiddenHeight > 48 && rect.width >= 80 && rect.height >= 80;
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
      && /(auto|scroll|overlay)/.test(style.overflowY);
    const horizontal = element.scrollWidth > element.clientWidth + 1
      && /(auto|scroll|overlay)/.test(style.overflowX);
    return vertical || horizontal;
  }

  function isSelfScrollable(element) {
    const style = getComputedStyle(element);
    return element.scrollHeight > element.clientHeight + 1
      && /(auto|scroll|overlay)/.test(style.overflowY);
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
      .filter((element) => element instanceof HTMLElement && isSelfScrollable(element));
    return regions.sort((a, b) => scoreScrollRegion(b) - scoreScrollRegion(a))[0] || null;
  }

  function scoreScrollRegion(element) {
    const rect = element.getBoundingClientRect();
    const hiddenHeight = Math.max(0, element.scrollHeight - element.clientHeight);
    return hiddenHeight * Math.max(1, rect.width);
  }

  function readInnerGeometry(element) {
    const borderRect = element.getBoundingClientRect();
    if (borderRect.width <= 0 || borderRect.height <= 0 || element.offsetWidth <= 0 || element.offsetHeight <= 0) {
      throw new Error("The selected element is not visible.");
    }
    const scaleX = borderRect.width / element.offsetWidth;
    const scaleY = borderRect.height / element.offsetHeight;
    const left = borderRect.left + element.clientLeft * scaleX;
    const top = borderRect.top + element.clientTop * scaleY;
    const width = element.clientWidth * scaleX;
    const height = element.clientHeight * scaleY;
    return {
      scaleX,
      scaleY,
      rect: {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      },
    };
  }

  function lockRectSize(current, locked) {
    return {
      left: current.left,
      top: current.top,
      right: current.left + locked.width,
      bottom: current.top + locked.height,
      width: locked.width,
      height: locked.height,
    };
  }

  function toPlainRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function assertFullyVisible(rect, label) {
    if (
      rect.left < -VIEWPORT_TOLERANCE
      || rect.top < -VIEWPORT_TOLERANCE
      || rect.right > window.innerWidth + VIEWPORT_TOLERANCE
      || rect.bottom > window.innerHeight + VIEWPORT_TOLERANCE
    ) {
      throw new Error(`Move the ${label} fully into the viewport before capturing it.`);
    }
  }

  function assertPaddedRectFullyVisible(rect, padding, label) {
    assertFullyVisible({
      left: rect.left - padding,
      top: rect.top - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
    }, label);
  }

  function rectsOverlap(first, second) {
    return first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top;
  }

  function rectsOverlapVertically(first, second) {
    return first.top < second.bottom && first.bottom > second.top;
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

  function sanitizeDocumentClip(clip) {
    const maxDimension = 32767;
    return {
      x: Math.max(0, clip.x),
      y: Math.max(0, clip.y),
      width: clamp(clip.width, 1, maxDimension),
      height: clamp(clip.height, 1, maxDimension),
    };
  }

  function createSessionId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
    if (!document.hasFocus()) {
      window.focus();
    }
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
  }

  async function waitForPaint() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  function normalizeError(error) {
    return error instanceof Error ? error.message : String(error || "Something went wrong.");
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
        width: 11px;
        height: 11px;
        margin-right: 8px;
        border: 2px solid rgba(255,255,255,.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin .8s linear infinite;
        vertical-align: -1px;
      }
      [hidden] { display: none !important; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes enter { from { opacity: 0; transform: translateY(8px); } }
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
    help.hidden = true;
    help.innerHTML = `
      <span class="mark">●</span>
      <span>Click to capture</span>
      <kbd>F</kbd><span>Full page/window</span>
      <kbd>↑</kbd><span>Parent</span>
      <kbd>Esc</kbd>
    `;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.hidden = true;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    shadow.append(style, focus, help, toast);
    (document.documentElement || document.body).append(host);
    return { host, shadow, focus, badge, label, meta, help, toast, toastTimer: null };
  }
})();
