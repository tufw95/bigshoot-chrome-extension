# Bigshoot test plan

## Installation

- [ ] Load the unpacked extension successfully in Chrome 109 or later.
- [ ] Confirm the icon renders correctly at 16, 32, 48, and 128 px.
- [ ] Confirm right-clicking the icon shows **Bigshoot settings**.
- [ ] Confirm capture is rejected on `chrome://extensions` with an error badge.

## Full-page capture

- [ ] Click the toolbar icon and confirm capture starts immediately without a picker.
- [ ] Press `⌘⇧6` on macOS or `Ctrl+Shift+6` elsewhere and confirm capture starts immediately.
- [ ] Capture a page several viewports tall and confirm the final content is present.
- [ ] Open `Chargeblast.mhtml`, capture it, and confirm the drawer's final rows are present in the PNG.
- [ ] Repeat the `Chargeblast.mhtml` capture three times and confirm no duplicate rows or cropped bottom content.
- [ ] Start while the page is scrolled and confirm the PNG still begins at the document top.
- [ ] Confirm the page scroll position and DOM are restored after any temporary capture layout expansion.
- [ ] On a Retina display, confirm the output uses the page's CSS-pixel dimensions for faster, lighter PNGs.
- [ ] Confirm no `F`, parent-selection, element-selection, or modal-specific behavior remains.

## Keyboard shortcut

- [ ] Open Settings and confirm the assigned shortcut is displayed.
- [ ] Select **Change shortcut** and confirm Chrome opens `chrome://extensions/shortcuts`.
- [ ] Change the shortcut and confirm Settings displays the new value when focused again.

## Destination

- [ ] **Save to device** uses Chrome's configured download location.
- [ ] Enable **Ask where to save each file before downloading** and confirm Chrome opens its file chooser.
- [ ] Disable that setting and confirm Chrome downloads without forcing a file chooser.
- [ ] Confirm filenames are valid and older captures are not overwritten.
- [ ] **Copy to clipboard** can be pasted as a PNG into Slack, Docs, or Preview.
- [ ] Confirm the toolbar badge reports success or failure.
- [ ] Confirm destination settings persist after Chrome restarts.

## Error cases

- [ ] With DevTools open on the tab, confirm Bigshoot asks the user to close DevTools.
- [ ] Confirm a page at least 40,000 CSS px tall captures fully.
- [ ] Confirm an extremely large page that exceeds Chrome memory returns a clear error.
- [ ] Navigate the tab during capture and confirm no debugger connection remains attached.
- [ ] Disable **Allow access to file URLs**, capture a local MHTML file, and confirm the badge tells the user how to enable it.
