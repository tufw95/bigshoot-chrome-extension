# Changelog

## 1.0.1 - 2026-08-12

- Write PNG data through the active tab so the clipboard receives a native image instead of failing in an unfocused offscreen document.
- Move capture notifications into a viewport-fixed bottom-right layer so pages cannot clip them.
- Follow Chrome's download location and file-prompt preference instead of creating a `Bigshoot` folder.

## 1.0.0 - 2026-08-12

- Select elements directly with the pointer and preview their dimensions before capture.
- Capture an entire element, including content inside an independently scrollable region.
- Capture a full page with `F` or by selecting the page root.
- Add configurable padding around element captures.
- Save PNG files to the device or copy them to the clipboard.
- Add a settings page and an action-icon context menu.
