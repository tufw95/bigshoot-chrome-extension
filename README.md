# Bigshoot

Bigshoot is a focused Chrome extension for capturing the entire active webpage as a single PNG. There is no element picker, capture mode, or stitching workflow.

## How to use it

Press `⌘⇧6` on macOS (`Ctrl+Shift+6` elsewhere), or click the Bigshoot camera icon. Bigshoot briefly scrolls through the page to wake lazy-rendered content, then captures the complete page at the display's native pixel density.

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

When capturing a local `file://` page or MHTML file, open the Bigshoot entry on `chrome://extensions` and enable **Allow access to file URLs**. Chrome requires this switch for local files even when the extension declares the file host permission.

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

- Extremely large pages may exceed Chrome's available image or GPU memory.
- Bigshoot warms lazy-rendered content by scrolling through the page before capture, but content that the website never renders may still be absent.
- Canvas, WebGL, video, and cross-origin iframe content may vary with page security policies.
- If the page is an app shell whose document itself is viewport-sized but has one dominant visible vertical drawer or panel, Bigshoot temporarily expands that region, warms it by scrolling, captures it, and restores the original layout and scroll position.
- When that drawer or panel is a fixed/sticky fullscreen surface, Bigshoot crops the PNG to that top surface so the page behind it is not included.
- Normal pages use native Retina/device pixels. Extremely large pages automatically fall back to a safer CSS-pixel scale when Chrome's image-memory limits require it.

## Privacy

Bigshoot does not collect or transmit data. See [PRIVACY.md](PRIVACY.md) for details.

## License

[MIT](LICENSE)
