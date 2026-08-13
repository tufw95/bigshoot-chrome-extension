import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const requiredFiles = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
];

for (const file of new Set(requiredFiles)) {
  await access(file, constants.R_OK);
}

if (manifest.manifest_version !== 3) {
  throw new Error("Extension must use Manifest V3.");
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error("Manifest version must use x.y.z format.");
}

if (!manifest.permissions.includes("debugger")) {
  throw new Error("Full-page capture requires the debugger permission.");
}

if (!manifest.permissions.includes("scripting")) {
  throw new Error("Full-page capture requires the scripting permission.");
}

if (!manifest.host_permissions?.includes("file:///*")) {
  throw new Error("Local MHTML capture requires the file:///* host permission.");
}

console.log(`Validated ${manifest.name} v${manifest.version}`);
