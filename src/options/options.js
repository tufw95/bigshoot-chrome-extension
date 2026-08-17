const DEFAULT_SETTINGS = {
  destination: "download",
};

const form = document.querySelector("#settings-form");
const status = document.querySelector("#status");
const commandShortcut = document.querySelector("#command-shortcut");
const changeShortcutButton = document.querySelector("#change-shortcut");

restoreSettings();
restoreShortcut();

form.addEventListener("submit", saveSettings);
changeShortcutButton.addEventListener("click", openShortcutSettings);
window.addEventListener("focus", restoreShortcut);

async function restoreSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const destination = form.elements.destination;
  for (const radio of destination) {
    radio.checked = radio.value === settings.destination;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const destination = new FormData(form).get("destination");
  await chrome.storage.sync.set({
    destination,
  });

  status.textContent = "Saved. Your next capture will use this setting.";
  setTimeout(() => {
    status.textContent = "";
  }, 2200);
}

async function restoreShortcut() {
  const commands = await chrome.commands.getAll();
  const actionCommand = commands.find((command) => command.name === "_execute_action");
  commandShortcut.textContent = actionCommand?.shortcut
    ? formatShortcut(actionCommand.shortcut)
    : "Not set";
}

async function openShortcutSettings() {
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
}

function formatShortcut(shortcut) {
  return shortcut
    .replace(/Command/gi, "⌘")
    .replace(/MacCtrl/gi, "⌃")
    .replace(/Ctrl/gi, "Ctrl")
    .replace(/Alt/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .split("+")
    .join(" ");
}
