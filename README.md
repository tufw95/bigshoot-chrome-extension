# Bigshoot

Bigshoot is a Chrome extension that captures an entire DOM element using the familiar **Capture node screenshot** workflow from DevTools, without requiring users to open DevTools. Independently scrollable regions, such as sidebars and drawer bodies, are captured by scrolling the real region and stitching only newly revealed pixels. Bigshoot does not expand or reflow the page layout.

## How to use it

1. Click the Bigshoot camera icon in the Chrome toolbar.
2. Move the pointer to select an element. The cyan frame shows the target and expected image size.
3. Click to capture it.
4. Press `F` to capture the full page. If a modal, drawer, or dialog is open, `F` captures its complete scrollable content instead. Press `↑` to select the parent element, or `Esc` to cancel.

Press `⌘⇧6` on macOS (`Ctrl+Shift+6` elsewhere) to open Bigshoot without clicking the toolbar icon. Chrome owns extension shortcuts; use **Bigshoot settings → Change shortcut** to customize it.

To change where screenshots are sent, right-click the Bigshoot icon, choose **Bigshoot settings**, then select:

- **Save to device**: follows Chrome's current download location and **Ask where to save each file before downloading** setting.
- **Copy to clipboard**: pastes directly into chat, documents, or design tools.

## Install from source

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the project directory containing `manifest.json`.
5. Pin Bigshoot to the Chrome toolbar.

Chrome does not allow extensions to run on internal pages such as `chrome://`, the Chrome Web Store, and some system viewers. Close DevTools on the tab before capturing because Chrome only permits one debugger connection to a tab at a time.

## Development

Node.js 20 or later is required. The extension has no runtime dependencies and does not send data to external services.

```bash
npm run check
npm run package
```

The Chrome Web Store-ready archive is created at `dist/bigshoot-<version>.zip`.

## Project structure

```text
manifest.json                 Manifest V3 configuration and permissions
src/background.js             Capture, download, and clipboard coordination
src/picker.js                 In-page element picker
src/options/                  Settings page
icons/                        Extension icons
docs/STORE_SUBMISSION.md      Internal publishing checklist
docs/TEST_PLAN.md             Manual test scenarios
```

## Technical limitations

- Pages or elements larger than 32,767 px on either axis may be limited by Chrome or the GPU rendering pipeline.
- Lazy-loaded content that appears only after scrolling must be loaded before capture.
- Canvas, WebGL, video, and cross-origin iframe content may behave differently depending on the page's security policies.
- Virtualized lists may only expose rows that the website renders while Bigshoot scrolls through them.

## Privacy

Bigshoot does not collect or transmit data. See [PRIVACY.md](PRIVACY.md) for details.

## License

[MIT](LICENSE)
