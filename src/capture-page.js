(() => {
  const GLOBAL_KEY = "__bigshootFullPageCapture";

  if (globalThis[GLOBAL_KEY]) {
    return;
  }

  const state = {
    changes: [],
    scrollPositions: [],
    viewportWidth: null,
    windowScroll: null,
  };

  globalThis[GLOBAL_KEY] = {
    prepare,
    readStableViewport,
    scrollTo,
    restore,
  };

  function readStableViewport() {
    if (!Number.isFinite(state.viewportWidth)) {
      state.viewportWidth = innerWidth;
    }
    return { width: state.viewportWidth, height: innerHeight };
  }

  function prepare() {
    restore();
    state.windowScroll = { x: scrollX, y: scrollY };
    setStyle(document.documentElement, "scroll-behavior", "auto");
    const originalDocumentSize = readDocumentSize();
    if (originalDocumentSize.height > innerHeight + 2) {
      return {
        expanded: false,
        originalDocumentSize,
        documentSize: originalDocumentSize,
      };
    }
    const candidate = findDominantVerticalScroller();
    if (!candidate) {
      return {
        expanded: false,
        originalDocumentSize,
        documentSize: originalDocumentSize,
      };
    }

    const surface = findViewportSurface(candidate);
    const captureRect = readCaptureRect(surface);
    expandScrollerIntoDocument(candidate, surface);
    return {
      expanded: true,
      originalDocumentSize,
      documentSize: readDocumentSize(),
      captureRect,
      scroller: {
        clientHeight: candidate.clientHeight,
        scrollHeight: candidate.scrollHeight,
      },
    };
  }

  function restore() {
    for (let index = state.changes.length - 1; index >= 0; index -= 1) {
      const change = state.changes[index];
      if (!change.element.isConnected) {
        continue;
      }
      if (change.hadAttribute) {
        change.element.style.setProperty(change.property, change.value, change.priority);
      } else {
        change.element.style.removeProperty(change.property);
      }
      if (!change.styleAttributeExisted && !change.element.getAttribute("style")) {
        change.element.removeAttribute("style");
      }
    }
    state.changes = [];
    for (const entry of state.scrollPositions) {
      if (entry.element.isConnected) {
        entry.element.scrollTop = entry.top;
        entry.element.scrollLeft = entry.left;
      }
    }
    state.scrollPositions = [];

    if (state.windowScroll) {
      const target = state.windowScroll;
      const html = document.documentElement;
      const styleAttributeExisted = html.hasAttribute("style");
      const behavior = html.style.getPropertyValue("scroll-behavior");
      const priority = html.style.getPropertyPriority("scroll-behavior");
      html.style.setProperty("scroll-behavior", "auto", "important");
      window.scrollTo(target.x, target.y);
      if (behavior) {
        html.style.setProperty("scroll-behavior", behavior, priority);
      } else {
        html.style.removeProperty("scroll-behavior");
      }
      if (!styleAttributeExisted && !html.getAttribute("style")) {
        html.removeAttribute("style");
      }
      state.windowScroll = null;
    }
  }

  async function scrollTo(x, y) {
    window.scrollTo(Number(x) || 0, Number(y) || 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      x: window.scrollX,
      y: window.scrollY,
      width: innerWidth,
      height: innerHeight,
    };
  }

  function findDominantVerticalScroller() {
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    let best = null;

    for (const element of document.querySelectorAll("body *")) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const style = getComputedStyle(element);
      const hiddenHeight = element.scrollHeight - element.clientHeight;
      if (
        hiddenHeight <= 1
        || !/(auto|scroll|overlay)/.test(style.overflowY)
        || style.visibility === "hidden"
        || style.display === "none"
      ) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.min(innerWidth, rect.right) - Math.max(0, rect.left);
      const visibleHeight = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
      if (visibleWidth <= 0 || visibleHeight <= 0) {
        continue;
      }

      const visibleAreaRatio = (visibleWidth * visibleHeight) / viewportArea;
      if (
        visibleAreaRatio < 0.25
        || visibleWidth < innerWidth * 0.5
        || visibleHeight < innerHeight * 0.5
      ) {
        continue;
      }

      const score = visibleAreaRatio * Math.log2(hiddenHeight + 2);
      if (!best || score > best.score) {
        best = { element, score };
      }
    }

    return best?.element || null;
  }

  function expandScrollerIntoDocument(scroller, surface = findViewportSurface(scroller)) {
    const shell = scroller.parentElement;

    state.scrollPositions.push({
      element: scroller,
      top: scroller.scrollTop,
      left: scroller.scrollLeft,
    });
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;

    setStyle(document.documentElement, "height", "auto");
    setStyle(document.body, "height", "auto");

    if (surface) {
      const surfaceStyle = getComputedStyle(surface);
      if (surfaceStyle.position === "fixed" || surfaceStyle.position === "sticky") {
        setStyle(surface, "position", "absolute");
      }
      setStyle(surface, "height", "auto");
      setStyle(surface, "max-height", "none");
      setStyle(surface, "min-height", "100vh");
      setStyle(surface, "overflow", "visible");
    }

    if (shell && shell !== surface) {
      setStyle(shell, "height", "auto");
      setStyle(shell, "max-height", "none");
      setStyle(shell, "min-height", "100vh");
      setStyle(shell, "overflow", "visible");
    }

    setStyle(scroller, "height", "auto");
    setStyle(scroller, "max-height", "none");
    setStyle(scroller, "overflow", "visible");
    setStyle(scroller, "flex", "none");
  }

  function findViewportSurface(scroller) {
    let surface = null;
    for (let element = scroller.parentElement; element && element !== document.body; element = element.parentElement) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const coversViewport = rect.width >= innerWidth * 0.5 && rect.height >= innerHeight * 0.75;
      if (coversViewport) {
        surface = element;
      }
      if (coversViewport && (style.position === "fixed" || style.position === "sticky")) {
        return element;
      }
    }
    return surface;
  }

  function readCaptureRect(surface) {
    if (!(surface instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(surface);
    const rect = surface.getBoundingClientRect();
    const coversViewport = rect.width >= innerWidth * 0.5 && rect.height >= innerHeight * 0.75;
    if (!coversViewport || !["fixed", "sticky"].includes(style.position)) {
      return null;
    }
    // Keep the edge of an app drawer out of the image when the page behind it
    // paints a divider or a narrow sticky rail above the drawer boundary.
    const edgeInset = Math.min(4, Math.max(0, Math.floor(rect.width / 100)));
    return {
      x: Math.max(0, Math.round(rect.left + scrollX + edgeInset)),
      y: Math.max(0, Math.round(rect.top + scrollY)),
      width: Math.max(1, Math.round(rect.width - edgeInset)),
    };
  }

  function setStyle(element, property, value) {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    state.changes.push({
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
      hadAttribute: Boolean(element.style.getPropertyValue(property)),
      styleAttributeExisted: element.hasAttribute("style"),
    });
    element.style.setProperty(property, value, "important");
  }

  function readDocumentSize() {
    return {
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    };
  }
})();
