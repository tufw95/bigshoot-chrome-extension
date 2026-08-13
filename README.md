# Bigshoot

Bigshoot is a focused Chrome extension for capturing the entire active webpage as a single PNG. There is no element picker, capture mode, or stitching workflow.

## How to use it

Press `⌘⇧6` on macOS (`Ctrl+Shift+6` elsewhere), or click the Bigshoot camera icon. The full page is captured immediately, including content below the browser viewport.

Chrome owns extension shortcuts. Use **Bigshoot settings → Change shortcut** to customize it.

To change the screenshot destination, right-click the Bigshoot icon and choose **Bigshoot settings**:

- **Save to device** follows Chrome's download location and **Ask where to save each file before downloading** setting.
- **Copy to clipboard** places the PNG on the system clipboard.

## Install from source

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the project directory containing `manifest.json`.
5. Pin Bigshoot to the Chrome toolbar.

Chrome does not allow capture on internal pages such as `chrome://` or the Chrome Web Store. Close DevTools on the active tab before capturing because Chrome permits only one debugger connection per tab.

## Development

Node.js 20 or later is required. The extension has no runtime dependencies and sends no data to external services.

```bash
npm run check
npm run test:capture
npm run package
```

The Chrome Web Store archive is created at `dist/bigshoot-<version>.zip`.

## Project structure

```text
manifest.json                 Manifest V3 configuration and permissions
src/background.js             Full-page capture and destination coordination
src/options/                  Settings page
icons/                        Extension icons
docs/STORE_SUBMISSION.md      Internal publishing checklist
docs/TEST_PLAN.md             Manual test scenarios
```

## Technical limitations

- Pages larger than 32,767 px on either axis exceed Chrome's safe screenshot limit.
- Lazy-loaded content that has not been rendered by the website may be absent.
- Canvas, WebGL, video, and cross-origin iframe content may vary with page security policies.
- This mode captures the document, matching full-page browser screenshot behavior; independently scrolling drawers are not expanded.

## Privacy

Bigshoot does not collect or transmit data. See [PRIVACY.md](PRIVACY.md) for details.

## License

[MIT](LICENSE)
