(() => {
  const token = decodeURIComponent(location.hash.slice(1));
  if (!token) {
    return;
  }

  copy().catch((error) => report(false, error.message));

  async function copy() {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Chrome's clipboard API is unavailable.");
    }
    const response = await chrome.runtime.sendMessage({
      type: "BIGSHOOT_CLIPBOARD_REQUEST",
      token,
    });
    const dataUrl = response?.dataUrl;
    if (!dataUrl) {
      throw new Error("The captured PNG is no longer available.");
    }
    const imageResponse = await fetch(dataUrl);
    if (!imageResponse.ok) {
      throw new Error("Chrome could not decode the captured PNG.");
    }
    const blob = await imageResponse.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    report(true);
  }

  function report(ok, error = "") {
    chrome.runtime.sendMessage({
      type: "BIGSHOOT_CLIPBOARD_RESULT",
      token,
      ok,
      error,
    });
  }
})();
