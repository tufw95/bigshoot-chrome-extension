import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const archive = path.join(projectRoot, `dist/bigshoot-${manifest.version}.zip`);
const mhtmlPath = path.join(projectRoot, "Chargeblast.mhtml");
const artifactRoot = path.join(projectRoot, "output/playwright");
const playwrightPath = "/Users/tutran/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.js";
const chromePath = "/Users/tutran/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

try {
  await Promise.all([access(archive), access(mhtmlPath), access(playwrightPath), access(chromePath)]);
} catch {
  console.log("Skipping packaged Chargeblast E2E: package, local MHTML, or Chrome is unavailable.");
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), "bigshoot-package-e2e-"));
const extensionRoot = path.join(root, "extension");
const unzip = spawnSync("unzip", ["-q", archive, "-d", extensionRoot], { encoding: "utf8" });
assert.equal(unzip.status, 0, unzip.stderr || "Could not extract package.");

const packagedManifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
assert.deepEqual(packagedManifest, manifest, "Packaged manifest differs from the production manifest.");
await Promise.all([
  access(path.join(extensionRoot, "src/clipboard.html")),
  access(path.join(extensionRoot, "src/clipboard.js")),
]);
const backgroundPath = path.join(extensionRoot, "src/background.js");
const background = await readFile(backgroundPath, "utf8");
await writeFile(backgroundPath, `${background}\nglobalThis.__bigshootTestCapture = captureFullPage;\n`);

const playwright = await import(playwrightPath);
const { chromium } = playwright.default || playwright;
const context = await chromium.launchPersistentContext(path.join(root, "profile"), {
  headless: false,
  executablePath: chromePath,
  acceptDownloads: true,
  viewport: { width: 1440, height: 900 },
  args: [
    `--disable-extensions-except=${extensionRoot}`,
    `--load-extension=${extensionRoot}`,
  ],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`file://${mhtmlPath}`);
  await page.waitForTimeout(500);
  const accessState = await worker.evaluate(async () => ({
    manifest: chrome.runtime.getManifest(),
    fileSchemeAllowed: await chrome.extension.isAllowedFileSchemeAccess(),
  }));
  assert.deepEqual(accessState.manifest, packagedManifest, "Chrome loaded a different manifest than the ZIP contains.");
  assert.equal(accessState.fileSchemeAllowed, true, "Test Chrome did not enable local file access.");

  await worker.evaluate(async () => chrome.storage.sync.set({ destination: "download" }));
  let dimensions;
  const durations = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const startedAt = performance.now();
    const existing = new Set(await worker.evaluate(async () => (
      (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 })).map((item) => item.id)
    )));
    const [tab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
    await worker.evaluate(async (tabId) => {
      const latest = await chrome.tabs.get(tabId);
      await globalThis.__bigshootTestCapture(latest);
    }, tab.id);

    const download = await waitFor(async () => worker.evaluate(async (knownIds) => {
      const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 });
      return items.find((item) => !knownIds.includes(item.id) && item.state === "complete") || null;
    }, [...existing]));
    durations.push(performance.now() - startedAt);
    const buffer = await readFile(download.filename);
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Packaged capture is not PNG.");
    const current = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    dimensions ||= current;
    assert.deepEqual(current, dimensions, `Packaged Chargeblast capture ${iteration + 1} changed dimensions.`);
    assert.equal(current.width, 2880, "Packaged Chargeblast PNG does not use native Retina width.");
    assert(current.height >= 2420, `Packaged Chargeblast PNG is cropped at ${current.height}px.`);
    if (iteration === 0) {
      await mkdir(artifactRoot, { recursive: true });
      await copyFile(download.filename, path.join(artifactRoot, "chargeblast-package-e2e.png"));
    }
  }
  await worker.evaluate(async () => chrome.storage.sync.set({ destination: "clipboard" }));
  const [clipboardTab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  await worker.evaluate(async (tabId) => {
    const latest = await chrome.tabs.get(tabId);
    await globalThis.__bigshootTestCapture(latest);
  }, clipboardTab.id);

  const averageDuration = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  assert(averageDuration < 3_000, `Packaged captures averaged ${averageDuration}ms.`);
  console.log(`Package E2E passed: exact ZIP manifest, file access, clipboard, 3 Chargeblast captures at ${dimensions.width}x${dimensions.height}, ${averageDuration}ms average.`);
} finally {
  await context.close();
}

async function waitFor(read, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for packaged capture.");
}
