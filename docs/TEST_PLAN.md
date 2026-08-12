# Bigshoot test plan

## Installation

- [ ] Load the unpacked extension successfully in Chrome 109 or later.
- [ ] Confirm the icon renders correctly at 16, 32, 48, and 128 px.
- [ ] Confirm right-clicking the icon shows **Bigshoot settings**.
- [ ] Confirm the extension does not run on `chrome://extensions` and briefly displays an error badge.

## Element picker

- [ ] Click the icon and move the pointer; the cyan frame follows the correct element.
- [ ] Confirm the label shows the node name, dimensions, and scrollable status.
- [ ] Confirm the capture click does not activate an underlying link or button.
- [ ] Press `↑` to select the parent element.
- [ ] Press `Esc` to exit and confirm the page works normally afterward.

## Screenshot capture

- [ ] Capture an element fully contained in the viewport.
- [ ] Capture an element taller than the viewport, including its lower content.
- [ ] Capture an element below the fold without first scrolling to the bottom.
- [ ] Capture an `overflow: auto` sidebar with all of its scrollable content.
- [ ] Move over a child inside a scrollable panel and confirm the picker prefers the complete scroll region when it contains substantially more hidden content.
- [ ] Confirm the page restores the sidebar height, overflow, and layout after capture.
- [ ] Press `F` and capture the full document height.
- [ ] Open a fixed modal or drawer with an independently scrolling body, press `F`, and capture all hidden content without the page behind it.
- [ ] Confirm the capture shows the final drawer row once, without repeating the drawer header or first content block below the original viewport boundary.
- [ ] With an open modal or drawer, select the page background and confirm the output captures the complete active surface rather than a cropped viewport.
- [ ] Confirm the modal or drawer returns to its original size and scroll position after capture.
- [ ] On a Retina or other high-density display, confirm output dimensions match the CSS dimensions shown by the picker.
- [ ] Change padding in Settings and confirm the output dimensions change as expected.

## Keyboard shortcut

- [ ] Press `⌘⇧6` on macOS or `Ctrl+Shift+6` elsewhere and confirm the element picker opens.
- [ ] Open Settings and confirm the currently assigned shortcut is displayed.
- [ ] Select **Change shortcut** and confirm Chrome opens `chrome://extensions/shortcuts`.
- [ ] Change the shortcut in Chrome and confirm Settings shows the new value when revisited.

## Destination

- [ ] **Save to device** uses Chrome's configured download location.
- [ ] Enable **Ask where to save each file before downloading** and confirm Chrome opens its file chooser.
- [ ] Disable that setting and confirm Chrome downloads without forcing a file chooser.
- [ ] Confirm filenames contain no invalid characters and do not overwrite older captures.
- [ ] **Copy to clipboard** can be pasted into Slack, Docs, or Preview.
- [ ] Confirm the success or error notification is fully visible in the bottom-right corner.
- [ ] Confirm settings persist after Chrome is closed and reopened.

## Error cases

- [ ] With DevTools open on the tab, confirm Bigshoot asks the user to close DevTools.
- [ ] Navigate the tab during capture and confirm no debugger connection remains attached.
- [ ] Remove the selected element during capture and confirm a clear error is displayed.
- [ ] Confirm an extremely large page or Chrome dimension-limit failure restores the page safely.
