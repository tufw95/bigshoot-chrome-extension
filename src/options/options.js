const DEFAULT_SETTINGS = {
  destination: "download",
  padding: 16,
};

const form = document.querySelector("#settings-form");
const paddingInput = document.querySelector("#padding");
const paddingValue = document.querySelector("#padding-value");
const status = document.querySelector("#status");

restoreSettings();

paddingInput.addEventListener("input", updatePaddingLabel);
form.addEventListener("submit", saveSettings);

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
