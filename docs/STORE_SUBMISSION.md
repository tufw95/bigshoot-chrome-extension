# Publish Bigshoot privately on the Chrome Web Store

This guide covers **Private** distribution to users in the same Google Workspace organization.

## 1. Build the package

```bash
npm run package
```

Output: `dist/bigshoot-1.1.4.zip`.

The Chrome Web Store does not accept the same version number twice. Update `manifest.json`, `package.json`, and `CHANGELOG.md` before later releases.

## 2. Create the listing

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Select **New item** and upload the ZIP from `dist/`.
3. Complete the listing using the suggested copy below.
4. Under **Distribution**, select **Private**.
5. Select the Google Workspace domain or tester group that may install it.
6. Complete **Privacy practices** and submit the extension for review.

## 3. Suggested listing copy

**Name**

> Bigshoot - Full Page Screenshots

**Short description**

> Capture the entire active webpage with one click or keyboard shortcut.

**Detailed description**

> Bigshoot captures the entire active webpage as a sharp PNG, including content below the browser viewport. Press Command+Shift+6 on macOS, Ctrl+Shift+6 elsewhere, or click the toolbar icon; Bigshoot briefly scrolls through the page to render lazy content, then captures the full document. Screenshots are saved using Chrome's download preferences or copied to the clipboard according to the user's setting. Bigshoot has no element picker, sends no data to a server, and restores any temporary capture layout changes and the original scroll position before returning control to the page.

**Suggested category**

> Tools

**Language**

> English

**Single purpose**

> Allow users to explicitly capture a PNG image of the entire active webpage.

## 4. Permission justifications

| Permission | Purpose |
| --- | --- |
| `activeTab` | Grants temporary access to the active tab after the user clicks the icon or invokes the shortcut. |
| `debugger` | Calls `Page.getLayoutMetrics` and `Page.captureScreenshot` to warm and capture the complete document beyond the viewport, then detaches immediately. |
| `downloads` | Saves the PNG using Chrome's current download settings. |
| `scripting` | Temporarily expands a visible app scroll container and warms the page before the full-document capture, then restores the page. |
| `clipboardWrite` | Copies the PNG when clipboard mode is selected. |
| `storage` | Stores the selected screenshot destination. |
| `contextMenus` | Adds **Bigshoot settings** to the toolbar icon's context menu. |
| `file:///*` | Allows explicit captures of local HTML and MHTML files. Users must also enable Chrome's **Allow access to file URLs** switch for the extension. |

## 5. Privacy practices

- The extension does not collect or sell user data.
- Screenshots and webpage content are not transmitted to a server.
- No remote code, analytics, advertising, or tracking is used.
- Only the destination preference is stored with Chrome Storage Sync.

Publish `PRIVACY.md` at a URL accessible to reviewers.

## 6. Upload assets

- Icon: `icons/icon-128.png`.
- Settings screenshot: `store-assets/screenshots/settings-1280x800.png`.
- Optionally add another 1280 x 800 screenshot showing the resulting full-page PNG.

## 7. Distribute with Google Admin Console

After approval, open **Devices → Chrome → Apps & extensions → Users & browsers**, select the organizational unit, add the extension by item ID, and choose **Allow install** or **Force install**.
