import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VIEWPORT = { width: 1200, height: 800 };
const DPR = 2;
const COLOR_TOLERANCE = 18;
const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtureUrl = `file://${path.join(projectRoot, "tests/fixture.html")}`;
const artifactRoot = path.join(projectRoot, "output/playwright");

const playwrightPath = await findDependency([
  "/Users/tutran/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.js",
  "/Users/tutran/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.js",
]);
const chromePath = await findDependency([
  "/Users/tutran/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]);

if (!playwrightPath || !chromePath) {
  console.log("Skipping capture E2E: Playwright or Chrome is unavailable.");
  process.exit(0);
}

const playwright = await import(playwrightPath);
const { chromium } = playwright.default || playwright;
const profile = await mkdtemp(path.join(os.tmpdir(), "bigshoot-full-page-e2e-"));
const extensionRoot = path.join(profile, "extension");
await copyExtension(projectRoot, extensionRoot);
await mkdir(artifactRoot, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: chromePath,
  acceptDownloads: true,
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  args: [
    `--disable-extensions-except=${extensionRoot}`,
    `--load-extension=${extensionRoot}`,
  ],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0] || await context.newPage();
  await page.goto(fixtureUrl);
  await page.evaluate(() => window.scrollTo(0, 777));

  await worker.evaluate(async () => {
    await chrome.storage.sync.set({ destination: "download" });
  });

  const before = await page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    marker: document.querySelector("#page-marker")?.textContent,
  }));
  const documentSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const downloadPromise = waitForNewDownload(worker);
  await triggerToolbarCapture(worker);
  const result = await readDownload(await downloadPromise);
  const artifact = path.join(artifactRoot, "e2e-full-page.png");
  await copyFile(result.filename, artifact);

  assert.equal(result.png.width, documentSize.width * DPR, "Full-page PNG has the wrong width/DPR.");
  assert.equal(result.png.height, documentSize.height * DPR, "Full-page PNG is cropped or has the wrong DPR.");
  assertVerticalSequence(result.png, 30 * DPR, [
    { color: "#153e5c", min: 710, max: 730 },
    { color: "#f4c95d", min: 1670, max: 1690 },
    { color: "#e86a33", min: 710, max: 730 },
    { color: "#2b8a6e", min: 710, max: 730 },
    { color: "#c13f5b", min: 710, max: 730 },
    { color: "#102a30", min: 150, max: 170 },
  ]);

  const after = await page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlStyle: document.documentElement.getAttribute("style"),
    bodyStyle: document.body.getAttribute("style"),
    marker: document.querySelector("#page-marker")?.textContent,
    pickerRoot: Boolean(document.querySelector("#bigshoot-extension-root")),
  }));
  assert.deepEqual(after, { ...before, pickerRoot: false }, "Capture changed the webpage or injected a picker.");

  const file = await stat(artifact);
  assert(file.size > 1_000, "Full-page PNG is unexpectedly small.");

  await worker.evaluate(async () => {
    await chrome.storage.sync.set({ destination: "clipboard" });
  });
  await triggerToolbarCapture(worker);

  console.log(
    `Capture E2E passed: one-click full page ${result.png.width}x${result.png.height}, clipboard, no DOM or scroll changes.`,
  );
} finally {
  await context.close();
}

async function triggerToolbarCapture(worker) {
  const [tab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  assert(tab?.id, "The fixture tab could not be found.");
  await worker.evaluate(async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    await globalThis.__bigshootTestCapture(tab);
  }, tab.id);
}

async function waitForNewDownload(worker) {
  const existing = new Set(await worker.evaluate(async () => (
    (await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 })).map((item) => item.id)
  )));
  return waitFor(async () => worker.evaluate(async (knownIds) => {
    const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 100 });
    return items.find((item) => !knownIds.includes(item.id) && item.state === "complete") || null;
  }, [...existing]), Boolean, 30_000);
}

async function readDownload(download) {
  const buffer = await readFile(download.filename);
  return { filename: download.filename, png: await decodePng(buffer) };
}

function assertVerticalSequence(png, x, expected) {
  const palette = [...new Set(expected.map(({ color }) => color))];
  const runs = [];
  for (let y = 0; y < png.height; y += 1) {
    const color = palette.find((candidate) => colorMatches(pixelAt(png, x, y), hexToRgb(candidate)));
    if (!color) continue;
    const previous = runs.at(-1);
    if (previous?.color === color && previous.end === y - 1) {
      previous.end = y;
      previous.length += 1;
    } else {
      runs.push({ color, start: y, end: y, length: 1 });
    }
  }

  const significant = runs.filter((run) => run.length >= 8);
  assert.deepEqual(
    significant.map((run) => run.color),
    expected.map((run) => run.color),
    `Full-page bands are missing or duplicated: ${JSON.stringify(significant)}`,
  );
  significant.forEach((run, index) => {
    const range = expected[index];
    assert(run.length >= range.min && run.length <= range.max, `Band ${index + 1} has ${run.length}px.`);
  });
}

function pixelAt(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
}

function colorMatches(actual, expected) {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= COLOR_TOLERANCE);
}

function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

async function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("The downloaded capture is not a PNG file.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels || buffer[24] !== 8 || buffer[26] !== 0 || buffer[27] !== 0) {
    throw new Error("The PNG uses an unsupported pixel format.");
  }

  const compressed = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") compressed.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return inflatePng(width, height, channels, Buffer.concat(compressed));
}

async function inflatePng(width, height, channels, compressed) {
  const { inflateSync } = await import("node:zlib");
  const raw = inflateSync(compressed);
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const row = Buffer.from(raw.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilter(row, previous, channels, filter);
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = channels === 4 ? row[source + 3] : 255;
    }
    row.copy(previous);
  }
  return { width, height, data: rgba };
}

function unfilter(row, previous, bytesPerPixel, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filter === 1) row[index] = (row[index] + left) & 255;
    else if (filter === 2) row[index] = (row[index] + up) & 255;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[index] = (row[index] + paeth(left, up, upperLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
  }
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance ? up : upperLeft;
}

async function waitFor(read, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
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
    if (file === "manifest.json") {
      const manifest = JSON.parse(await readFile(source, "utf8"));
      manifest.host_permissions = ["file:///*"];
      await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
    } else if (file === "src/background.js") {
      const sourceCode = await readFile(source, "utf8");
      await writeFile(target, `${sourceCode}\nglobalThis.__bigshootTestCapture = captureFullPage;\n`);
    } else {
      await copyFile(source, target);
    }
  }
}
