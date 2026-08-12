const DEFAULT_SETTINGS = {
  destination: "download",
  padding: 16,
};

const form = document.querySelector("#settings-form");
const paddingInput = document.querySelector("#padding");
const paddingValue = document.querySelector("#padding-value");
const status = document.querySelector("#status");
const commandShortcut = document.querySelector("#command-shortcut");
const changeShortcutButton = document.querySelector("#change-shortcut");

restoreSettings();
restoreShortcut();

paddingInput.addEventListener("input", updatePaddingLabel);
form.addEventListener("submit", saveSettings);
changeShortcutButton.addEventListener("click", openShortcutSettings);
window.addEventListener("focus", restoreShortcut);

async function restoreSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const destination = form.elements.destination;
  for (const radio of destination) {
    radio.checked = radio.value === settings.destination;
  }
  paddingInput.value = settings.padding;
  updatePaddingLabel();
}

async function saveSettings(event) {
  event.preventDefault();
  const destination = new FormData(form).get("destination");
  await chrome.storage.sync.set({
    destination,
    padding: Number(paddingInput.value),
  });

  status.textContent = "Saved. Your next capture will use this setting.";
  setTimeout(() => {
    status.textContent = "";
  }, 3500);
}

function updatePaddingLabel() {
  paddingValue.value = `${paddingInput.value} px`;
  paddingValue.textContent = `${paddingInput.value} px`;
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
