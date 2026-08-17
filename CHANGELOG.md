# Changelog

## 1.1.5 - 2026-08-17

- Add an in-page success toast for device downloads and clipboard copies.
- Detach the debugger before restoring the page and before the clipboard popup fallback so Chrome's debugger infobar can clear sooner.

## 1.1.4 - 2026-08-17

- Crop fullscreen app captures to the visible top layer so an underlying sidebar is not included.
- Release the debugger before starting a device download so Chrome's debugger infobar clears promptly.
- Refresh the Settings experience with a compact capture-console layout, clearer destination controls, responsive behavior, and a new capture-frame logo.

## 1.1.3 - 2026-08-17

- Warm the page by scrolling through its content before capture so lazy-rendered sections are present and the interaction feels like a real full-page capture.
- Restore the original document scroll position and `scroll-behavior` after the warm-up pass.
- Capture normal pages at native device-pixel density for sharper Retina screenshots; use a safer CSS-pixel scale only for very large images.
- Add a focused popup fallback for clipboard writes that are blocked on local MHTML/file pages.
- Add E2E coverage for native dimensions, scrolling warm-up, local MHTML clipboard, and the packaged clipboard helper.

## 1.1.2 - 2026-08-13

- Add local `file://` host access and document Chrome's required **Allow access to file URLs** switch.
- Expand the largest visible app scroll container before capture so app shells and saved MHTML files include content below an internal drawer or panel.
- Restore every temporary style and scroll position after capture.
- Test the exact production manifest instead of silently adding test-only permissions.

## 1.1.1 - 2026-08-13

- Reduce PNG rendering cost by capturing at CSS-pixel resolution and prioritizing Chrome's fast encoder.
- Remove Bigshoot's artificial 32,767 px page-height rejection; Chrome now decides the real capture limit.
- Add command timeouts, clearer failure messages, and feedback when a capture is already running.
- Add repeated-capture and 40,000 px page coverage to catch cropped or duplicated screenshots.

## 1.1.0 - 2026-08-13

- Remove the element picker, scrollable-element capture, padding, modal detection, and all picker keyboard controls.
- Make the toolbar icon and default keyboard shortcut capture the entire document immediately.
- Use a single Chrome DevTools Protocol full-page capture without scrolling or modifying the webpage.
- Write clipboard images through the active page's focused browser context.
- Remove the `scripting` permission and all packaged picker code.

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
