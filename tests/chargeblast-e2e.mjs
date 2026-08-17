import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const mhtmlPath = path.join(projectRoot, "Chargeblast.mhtml");
const artifactRoot = path.join(projectRoot, "output/playwright");
const NATIVE_SCALE = 2;
const playwrightPath = "/Users/tutran/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.js";
const chromePath = "/Users/tutran/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

try {
  await Promise.all([access(mhtmlPath), access(playwrightPath), access(chromePath)]);
} catch {
  console.log("Skipping Chargeblast E2E: local MHTML or Chrome is unavailable.");
  process.exit(0);
}

const playwright = await import(playwrightPath);
const { chromium } = playwright.default || playwright;
const profile = await mkdtemp(path.join(os.tmpdir(), "bigshoot-chargeblast-e2e-"));
const extensionRoot = path.join(profile, "extension");
await copyExtension(projectRoot, extensionRoot);
await mkdir(artifactRoot, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
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
  await worker.evaluate(async () => chrome.storage.sync.set({ destination: "download" }));

  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll("body *")].find((element) => (
      element instanceof HTMLElement
      && element.scrollHeight > element.clientHeight + 100
      && /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY)
      && element.clientWidth > innerWidth / 2
    ));
    if (scroller) scroller.scrollTop = 173;
  });

  const before = await inspectPage(page);
  assert(before.scroller, "Chargeblast must contain a visible vertical scroll container.");
  assert(before.scroller.hiddenHeight > 100, "Chargeblast fixture must have content below the drawer viewport.");
  assert(before.finalRow.top > before.viewport.height, "Chargeblast final row must start below the initial viewport.");

  let dimensions;
  const durations = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const startedAt = performance.now();
    const downloadPromise = waitForNewDownload(worker);
    await triggerCapture(worker);
    const download = await downloadPromise;
    const duration = performance.now() - startedAt;
    durations.push(duration);
    assert(duration < 3_000, `Chargeblast capture ${iteration + 1} took ${Math.round(duration)}ms.`);
    const buffer = await readFile(download.filename);
    const current = readPngDimensions(buffer);
    dimensions ||= current;
    assert.deepEqual(current, dimensions, `Chargeblast capture ${iteration + 1} changed dimensions.`);
    assert.equal(current.width, (before.scroller.state.rect.width - 4) * NATIVE_SCALE, "Chargeblast PNG must crop to the fullscreen drawer width.");
    assert(current.height >= (before.scroller.contentHeight - 2) * NATIVE_SCALE, `Chargeblast PNG is cropped: ${current.height}px vs ${before.scroller.contentHeight}px.`);
    assert(current.height > before.finalRow.bottom * NATIVE_SCALE, "Chargeblast PNG is cropped before the drawer's final row.");

    const after = await inspectPage(page);
    assert.deepEqual(after.html.style, before.html.style, "Chargeblast html styles changed after capture.");
    assert.deepEqual(after.body.style, before.body.style, "Chargeblast body styles changed after capture.");
    assert.deepEqual(after.scroller.state.style, before.scroller.state.style, "Chargeblast drawer styles changed after capture.");
    assert.equal(after.scroller.state.scrollTop, before.scroller.state.scrollTop, "Chargeblast drawer scroll changed after capture.");
    assert.equal(after.scroller.state.scrollLeft, before.scroller.state.scrollLeft, "Chargeblast drawer horizontal scroll changed after capture.");
    assert.equal(after.scroller.contentHeight, before.scroller.contentHeight, "Chargeblast drawer content geometry changed after capture.");

    if (iteration === 0) {
      await mkdir(artifactRoot, { recursive: true });
      await copyFile(download.filename, path.join(artifactRoot, "chargeblast-e2e.png"));
    }
  }

  await worker.evaluate(async () => chrome.storage.sync.set({ destination: "clipboard" }));
  await triggerCapture(worker);
  const clipboardToast = page.locator("#bigshoot-capture-toast");
  await clipboardToast.waitFor({ state: "visible" });
  assert.match(await clipboardToast.innerText(), /Copied to clipboard/);

  const averageDuration = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  console.log(`Chargeblast E2E passed: 3 captures at ${dimensions.width}x${dimensions.height}, ${averageDuration}ms average, clipboard toast, drawer included, page restored.`);
} finally {
  await context.close();
}

async function copyExtension(sourceRoot, targetRoot) {
  const files = [
    "manifest.json",
    "src/background.js",
    "src/capture-page.js",
    "src/clipboard.html",
    "src/clipboard.js",
    "src/options/options.css",
    "src/options/options.html",
    "src/options/options.js",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
  ];
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    const target = path.join(targetRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    if (file === "src/background.js") {
      const sourceCode = await readFile(source, "utf8");
      await writeFile(target, `${sourceCode}\nglobalThis.__bigshootTestCapture = captureFullPage;\n`);
    } else {
      await copyFile(source, target);
    }
  }
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const element = [...document.querySelectorAll("body *")].find((candidate) => (
      candidate instanceof HTMLElement
      && candidate.scrollHeight > candidate.clientHeight + 100
      && /(auto|scroll|overlay)/.test(getComputedStyle(candidate).overflowY)
      && candidate.clientWidth > innerWidth / 2
    ));
    const styleSnapshot = (node) => node && ({
      style: node.getAttribute("style"),
      scrollTop: node.scrollTop,
      scrollLeft: node.scrollLeft,
      rect: node.getBoundingClientRect().toJSON(),
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    });
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      html: styleSnapshot(document.documentElement),
      body: styleSnapshot(document.body),
      scroller: element && {
        path: element.id,
        hiddenHeight: element.scrollHeight - element.clientHeight,
        contentHeight: element.scrollHeight,
        state: styleSnapshot(element),
      },
      finalRow: (() => {
        const row = [...document.querySelectorAll("span")].find((node) => node.textContent.trim() === "Jul 1, 10:32 PM");
        const rect = row?.getBoundingClientRect();
        return rect ? { top: rect.top + (element?.scrollTop || 0), bottom: rect.bottom + (element?.scrollTop || 0) } : null;
      })(),
    };
  });
}

async function triggerCapture(worker) {
  const [tab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  assert(tab?.id, "Chargeblast tab not found.");
  await worker.evaluate(async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await globalThis.__bigshootTestCapture(tab);
  }, tab.id);
}

async function waitForNewDownload(worker, timeout = 30_000) {
  const existing = new Set(await worker.evaluate(async () => (
    (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 })).map((item) => item.id)
  )));
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const download = await worker.evaluate(async (knownIds) => {
      const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 });
      return items.find((item) => !knownIds.includes(item.id) && item.state === "complete") || null;
    }, [...existing]);
    if (download) {
      return download;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Chargeblast PNG download.");
}

function readPngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Capture is not a PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
