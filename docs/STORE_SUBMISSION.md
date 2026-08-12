# Publish Bigshoot privately on the Chrome Web Store

This guide covers **Private** distribution to users in the same Google Workspace organization.

## 1. Build the package

```bash
npm run package
```

Output: `dist/bigshoot-1.0.1.zip`.

Before publishing each new release, update all of the following:

- `version` in `manifest.json`.
- `version` in `package.json`.
- `CHANGELOG.md`.

The Chrome Web Store does not accept the same version number twice.

## 2. Create the listing

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Select **New item** and upload the ZIP from `dist/`.
3. Complete the listing using the suggested copy below.
4. Under **Distribution**, select **Private**.
5. Select the Google Workspace domain or tester group that may install it.
6. Complete **Privacy practices** and submit the extension for review.

The developer account may require the Chrome Web Store's one-time registration fee. For domain distribution, a Google Workspace administrator may also need to allow the extension in Admin Console.

## 3. Suggested listing copy

**Name**

> Bigshoot - Element Screenshots

**Short description**

> Capture an entire element, scrollable region, or full page with one click.

**Detailed description**

> Bigshoot brings Chrome DevTools' Capture node screenshot workflow to the browser toolbar. Click the icon, point to an element, and click again to create a PNG. Bigshoot can expand an independently scrollable region, such as a sidebar, to include hidden content, or capture the entire page with the F key. Screenshots are saved to the device or copied to the clipboard according to the user's setting. No data is sent to a server.

**Suggested category**

> Tools

**Language**

> English

**Single purpose**

> Allow users to explicitly capture a PNG image of a DOM element, an independently scrollable region, or the entire active webpage.

## 4. Permission justifications

The Chrome Web Store requires a clear explanation for each sensitive permission:

| Permission | Purpose |
| --- | --- |
| `activeTab` | Grants temporary access to the current tab only after the user clicks the Bigshoot icon. |
| `scripting` | Injects the element picker and measures the capture region in the active tab. |
| `debugger` | Calls the Chrome DevTools Protocol method `Page.captureScreenshot` to capture content beyond the viewport, equivalent to Capture node screenshot. The connection is detached immediately after every capture. |
| `downloads` | Saves a PNG to the device when the user selects download mode. |
| `clipboardWrite` | Copies a PNG to the clipboard when the user selects clipboard mode. |
| `storage` | Stores the screenshot destination and padding setting. |
| `contextMenus` | Adds **Bigshoot settings** to the action icon's context menu. |

No persistent host permission is requested. Bigshoot accesses only the active tab and only after an explicit user action.

## 5. Privacy practices

Suggested declarations:

- The extension does not collect user data.
- The extension does not sell data.
- Data is not used outside the extension's single purpose.
- Screenshots and page content are not transmitted to a server.
- No remote code is used; all JavaScript is included in the extension package.

Publish `PRIVACY.md` at a URL accessible to reviewers. If the repository remains private, use an internal public page available to users and reviewers, or publish only the policy through GitHub Pages or a public gist.

## 6. Upload assets

- Icon: `icons/icon-128.png`, 128 x 128 PNG.
- Picker screenshot: `store-assets/screenshots/picker-1280x800.png`.
- Settings screenshot: `store-assets/screenshots/settings-1280x800.png`.
- Promotional tile if the dashboard requires one at submission time.

The included screenshots are 1280 x 800 and contain no sensitive data. An additional screenshot of the final expanded-sidebar image may be added if the listing needs a clearer result example.

## 7. Distribute with Google Admin Console

After the Private listing is approved:

1. Open Google Admin Console.
2. Go to **Devices → Chrome → Apps & extensions → Users & browsers**.
3. Select the organizational unit or group.
4. Add the extension from the Chrome Web Store using its item ID.
5. Select **Allow install** or **Force install** according to the internal policy.

Menu labels may vary slightly by Admin Console version and Google Workspace subscription.
