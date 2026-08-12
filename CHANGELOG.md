# Changelog

## 1.0.4 - 2026-08-12

- Replace layout expansion with deterministic scroll-and-stitch capture for independently scrollable elements and open windows.
- Keep fixed, flex, overflow, and sticky page layouts intact to prevent duplicated or cropped content.
- Prefer the enclosing scroll region when the pointer is over its content, while keeping Arrow Up for manual parent selection.
- Preserve native high-density output and restore every captured scroll position and temporary style.
- Add pixel-level E2E coverage for static elements, padding, scrollable elements, sticky/fixed content, split drawers, full pages, and duplicate detection.

## 1.0.3 - 2026-08-12

- Expand the complete flex shell around independently scrolling content so fixed drawers and selected scroll regions include their final rows.
- Temporarily place sticky descendants in normal document flow during capture to prevent Chrome from repeating the top of a drawer below the original viewport boundary.
- Prefer meaningful scrollable ancestors in the element picker, making large scroll regions easier to select without precisely targeting their empty padding.
- Normalize screenshot output to CSS pixel dimensions on high-density displays.
- Treat full-page capture as full-window capture when an active modal, drawer, or dialog covers the page.

## 1.0.2 - 2026-08-12

- Make full capture detect an open modal, drawer, or dialog and include all content inside its independently scrolling body.
- Add `Command+Shift+6` on macOS and `Ctrl+Shift+6` elsewhere as the default Bigshoot shortcut.
- Show the active shortcut in Settings and link to Chrome's shortcut editor for customization.

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
