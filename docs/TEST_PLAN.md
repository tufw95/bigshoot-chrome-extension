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
- [ ] Confirm the page restores the sidebar height, overflow, and layout after capture.
- [ ] Press `F` and capture the full document height.
- [ ] Change padding in Settings and confirm the output dimensions change as expected.

## Destination

- [ ] **Save to device** creates a PNG in `Downloads/Bigshoot`.
- [ ] Confirm filenames contain no invalid characters and do not overwrite older captures.
- [ ] **Copy to clipboard** can be pasted into Slack, Docs, or Preview.
- [ ] Confirm settings persist after Chrome is closed and reopened.

## Error cases

- [ ] With DevTools open on the tab, confirm Bigshoot asks the user to close DevTools.
- [ ] Navigate the tab during capture and confirm no debugger connection remains attached.
- [ ] Remove the selected element during capture and confirm a clear error is displayed.
- [ ] Confirm an extremely large page or Chrome dimension-limit failure restores the page safely.
