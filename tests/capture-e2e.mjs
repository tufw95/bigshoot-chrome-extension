import assert from "node:assert/strict";
import { access, copyFile, mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const playwrightPath = await findDependency([
  "/Users/tutran/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.js",
  "/Users/tutran/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.js",
]);
const chromePath = await findDependency([
  "/Users/tutran/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/tutran/Library/Caches/ms-playwright/chromium-1237/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
]);

if (!playwrightPath || !chromePath) {
  console.log("Skipping capture E2E: Playwright or Chrome for Testing is unavailable.");
  process.exit(0);
}

const playwright = await import(playwrightPath);
const { chromium } = playwright.default || playwright;
const projectRoot = path.resolve(import.meta.dirname, "..");
const profile = await mkdtemp(path.join(os.tmpdir(), "bigshoot-e2e-"));
const testExtensionRoot = path.join(profile, "extension");
await copyExtension(projectRoot, testExtensionRoot);
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: chromePath,
  acceptDownloads: true,
  viewport: { width: 1200, height: 800 },
  args: [
    `--disable-extensions-except=${testExtensionRoot}`,
    `--load-extension=${testExtensionRoot}`,
  ],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`file://${path.join(projectRoot, "tests/fixture.html")}`);
  await page.click(".open-drawer");
  const originalScrollTop = await page.evaluate(() => {
    const body = document.querySelector("#scrolling-drawer-body");
    body.scrollTop = 180;
    return body.scrollTop;
  });

  const [tab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/picker.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "BIGSHOOT_START_PICKER" });
  }, tab.id);
  await page.keyboard.press("f");

  const prepared = await waitFor(async () => page.evaluate(() => {
    const drawer = document.querySelector(".test-drawer");
    const body = document.querySelector("#scrolling-drawer-body");
    return {
      drawerHeight: drawer.getBoundingClientRect().height,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyScrollTop: body.scrollTop,
      finalSectionBottom: document.querySelector(".drawer-section:last-child").getBoundingClientRect().bottom,
    };
  }), (value) => value.bodyClientHeight >= value.bodyScrollHeight);

  assert.equal(prepared.bodyScrollTop, 0);
  assert(prepared.finalSectionBottom <= prepared.drawerHeight + 1);

const download = await waitFor(async () => worker.evaluate(async () => {
    const [item] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    return item;
  }), (value) => value?.state === "complete");
  const screenshot = await stat(download.filename);
  assert(screenshot.size > 20_000);
  const dimensions = readPngDimensions(await readFile(download.filename));
  assert.deepEqual(dimensions, {
    width: Math.round(prepared.drawerHeight ? 680 : 0),
    height: Math.round(prepared.drawerHeight),
  });
  await copyFile(download.filename, path.join(projectRoot, "output/playwright/e2e-fixture-surface.png"));

  const restored = await waitFor(async () => page.evaluate(() => {
    const drawer = document.querySelector(".test-drawer");
    const body = document.querySelector("#scrolling-drawer-body");
    return {
      drawerHeight: drawer.getBoundingClientRect().height,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyScrollTop: body.scrollTop,
    };
  }), (value) => value.bodyClientHeight < value.bodyScrollHeight);

  assert.equal(restored.bodyScrollTop, originalScrollTop);
  assert(restored.drawerHeight < prepared.drawerHeight);
  console.log("Capture E2E passed: final drawer content is included and page state is restored.");
} finally {
  await context.close();
}

async function waitFor(read, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for capture state: ${JSON.stringify(value)}`);
}

async function findDependency(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known local dependency path.
    }
  }
  return null;
}

async function copyExtension(sourceRoot, targetRoot) {
  const files = [
    "manifest.json",
    "src/background.js",
    "src/picker.js",
    "src/options/options.css",
    "src/options/options.html",
    "src/options/options.js",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
  ];
  const { mkdir, writeFile } = await import("node:fs/promises");
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    const target = path.join(targetRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    if (file === "manifest.json") {
      const manifest = JSON.parse(await readFile(source, "utf8"));
      manifest.host_permissions = ["file:///*"];
      await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      await copyFile(source, target);
    }
  }
}

function readPngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("The downloaded capture is not a PNG file.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
