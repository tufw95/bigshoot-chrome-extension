# Bigshoot

Bigshoot is a Chrome extension that captures an entire DOM element using the familiar **Capture node screenshot** workflow from DevTools, without requiring users to open DevTools. It can temporarily expand an independently scrollable region, such as a sidebar, capture all hidden content, and restore the page to its original state.

## How to use it

1. Click the Bigshoot camera icon in the Chrome toolbar.
2. Move the pointer to select an element. The cyan frame shows the target and expected image size.
3. Click to capture it.
4. Press `F` for a full-page capture, `↑` to select the parent element, or `Esc` to cancel.

To change where screenshots are sent, right-click the Bigshoot icon, choose **Bigshoot settings**, then select:

- **Save to device**: creates a PNG in `Downloads/Bigshoot`.
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
src/offscreen/                PNG clipboard writer
icons/                        Extension icons
docs/STORE_SUBMISSION.md      Internal publishing checklist
docs/TEST_PLAN.md             Manual test scenarios
```

## Technical limitations

- Pages or elements larger than 32,767 px on either axis may be limited by Chrome or the GPU rendering pipeline.
- Lazy-loaded content that appears only after scrolling must be loaded before capture.
- Canvas, WebGL, video, and cross-origin iframe content may behave differently depending on the page's security policies.
- Layouts that reflow significantly when a sidebar is expanded may look slightly different from their original scrolled state.

## Privacy

Bigshoot does not collect or transmit data. See [PRIVACY.md](PRIVACY.md) for details.

## License

[MIT](LICENSE)
