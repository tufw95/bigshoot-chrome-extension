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
  "/Users/tutran/Library/Caches/ms-playwright/chromium-1237/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
]);

if (!playwrightPath || !chromePath) {
  console.log("Skipping capture E2E: Playwright or Chrome for Testing is unavailable.");
  process.exit(0);
}

const playwright = await import(playwrightPath);
const { chromium } = playwright.default || playwright;
const profile = await mkdtemp(path.join(os.tmpdir(), "bigshoot-e2e-"));
const testExtensionRoot = path.join(profile, "extension");
await copyExtension(projectRoot, testExtensionRoot);
await mkdir(artifactRoot, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: chromePath,
  acceptDownloads: true,
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  args: [
    `--disable-extensions-except=${testExtensionRoot}`,
    `--load-extension=${testExtensionRoot}`,
  ],
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const page = context.pages()[0] || await context.newPage();
  await waitFor(async () => worker.evaluate(async () => {
    await chrome.storage.sync.set({ destination: "download", padding: 0 });
    return chrome.storage.sync.get({ destination: "download", padding: 16 });
  }), (settings) => settings.destination === "download" && settings.padding === 0);

  await runCase("static-element", async () => {
    await resetPage(page);
    const png = await captureElement({ page, worker, selector: ".static-element" });
    assertDimensions(png, 420 * DPR, 240 * DPR, "static element");
    assertVerticalSequence(png, 30 * DPR, [
      { color: "#ea3546", min: 96, max: 120 },
      { color: "#3bceac", min: 96, max: 120 },
      { color: "#ffbe0b", min: 96, max: 120 },
      { color: "#5f4bb6", min: 96, max: 120 },
    ], "static element");
    return png;
  });

  await runCase("self-scroll", async () => {
    await resetPage(page);
    const originalScrollTop = await page.evaluate(() => {
      const target = document.querySelector("#self-scroll");
      target.scrollTop = 137;
      return target.scrollTop;
    });
    const png = await captureElement({
      page,
      worker,
      selector: "#self-scroll",
    });
    assertDimensions(png, 360 * DPR, 960 * DPR, "scrollable element");
    assertVerticalSequence(png, 30 * DPR, [
      { color: "#102a30", min: 90, max: 110 },
      { color: "#d7263d", min: 350, max: 370 },
      { color: "#1b998b", min: 350, max: 370 },
      { color: "#ff9f1c", min: 350, max: 370 },
      { color: "#5c4d7d", min: 350, max: 370 },
      { color: "#2d6cdf", min: 350, max: 370 },
      { color: "#102a30", min: 16, max: 24 },
    ], "scrollable element");
    await assertScrollRestored(page, "#self-scroll", originalScrollTop);
    return png;
  });

  await runCase("scroll-padding", async () => {
    await resetPage(page);
    const png = await captureElement({
      page,
      worker,
      selector: "#self-scroll",
      padding: 16,
    });
    assertDimensions(png, (360 + 32) * DPR, (960 + 32) * DPR, "scrollable element padding");
    return png;
  });

  await runCase("drawer", async () => {
    await resetPage(page);
    await page.click(".open-drawer");
    const originalScrollTop = await page.evaluate(() => {
      const target = document.querySelector("#drawer-body");
      target.scrollTop = 173;
      return target.scrollTop;
    });
    const png = await captureFull(page, worker);
    assertDimensions(png, 520 * DPR, 1080 * DPR, "drawer surface");
    assertVerticalSequence(png, 30 * DPR, [
      { color: "#102a30", min: 220, max: 228 },
      { color: "#7ae7c7", min: 12, max: 20 },
      { color: "#ef476f", min: 470, max: 490 },
      { color: "#118ab2", min: 470, max: 490 },
      { color: "#f78c6b", min: 470, max: 490 },
      { color: "#6a4c93", min: 470, max: 490 },
    ], "drawer surface");
    assertColorPixelCount(png, "#00b4d8", 22_000, "drawer fixed control duplication");
    await assertScrollRestored(page, "#drawer-body", originalScrollTop);
    const restoredFixedVisibility = await page.evaluate(() => (
      getComputedStyle(document.querySelector(".drawer-fixed-control")).visibility
    ));
    assert.equal(restoredFixedVisibility, "visible", "drawer fixed control visibility was not restored.");
    return png;
  });

  await runCase("split-drawer", async () => {
    await resetPage(page);
    await page.click(".open-drawer");
    await page.evaluate(() => {
      document.querySelector(".test-drawer").dataset.layout = "split";
    });
    const png = await captureFull(page, worker);
    assertDimensions(png, 520 * DPR, 1080 * DPR, "split drawer surface");
    assertColorPixelCount(png, "#023047", 340_000, "split drawer static rail duplication");
    const restoredRailVisibility = await page.evaluate(() => (
      getComputedStyle(document.querySelector(".drawer-static-rail")).visibility
    ));
    assert.equal(restoredRailVisibility, "visible", "split drawer static rail visibility was not restored.");
    return png;
  });

  await runCase("full-page", async () => {
    await resetPage(page);
    await page.evaluate(() => window.scrollTo(0, 777));
    const png = await captureFull(page, worker);
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assertDimensions(png, VIEWPORT.width * DPR, documentHeight * DPR, "full page");
    assertVerticalSequence(png, 30 * DPR, [
      { color: "#153e5c", min: 710, max: 730 },
      { color: "#f4c95d", min: 1670, max: 1690 },
      { color: "#e86a33", min: 710, max: 730 },
      { color: "#2b8a6e", min: 710, max: 730 },
      { color: "#c13f5b", min: 710, max: 730 },
      { color: "#102a30", min: 150, max: 170 },
    ], "full page");
    return png;
  });

  console.log("Capture E2E passed: static, scrollable, padding, drawer, split drawer, restoration, full-page, DPR, crop, and duplicate checks.");
} finally {
  await context.close();
}

async function runCase(name, capture) {
  const result = await capture();
  const artifact = path.join(artifactRoot, `e2e-${name}.png`);
  await copyFile(result.filename, artifact);
  const file = await stat(artifact);
  assert(file.size > 1_000, `${name}: PNG is unexpectedly small.`);
  console.log(`  passed ${name}: ${result.png.width}x${result.png.height}`);
}

async function resetPage(page) {
  await page.goto(fixtureUrl);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function captureElement({ page, worker, selector, clickOffset, padding = 0 }) {
  await setCaptureSettings(worker, padding);
  await startPicker(worker, page);
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert(box, `${selector}: target has no visible bounding box.`);
  const downloadPromise = waitForNewDownload(worker);
  const point = clickOffset || { x: box.width / 2, y: Math.min(24, box.height / 2) };
  await page.mouse.click(box.x + point.x, box.y + point.y);
  return readDownload(await downloadPromise);
}

async function captureFull(page, worker) {
  await setCaptureSettings(worker);
  await startPicker(worker, page);
  const downloadPromise = waitForNewDownload(worker);
  await page.keyboard.press("f");
  return readDownload(await downloadPromise);
}

async function setCaptureSettings(worker, padding = 0) {
  await worker.evaluate(async (value) => {
    await chrome.storage.sync.set({ destination: "download", padding: value });
  }, padding);
}

async function startPicker(worker, page) {
  const [tab] = await worker.evaluate(async () => chrome.tabs.query({ active: true, currentWindow: true }));
  assert(tab?.id, "The fixture tab could not be found.");
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/picker.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "BIGSHOOT_START_PICKER" });
  }, tab.id);
  await page.waitForFunction(() => document.documentElement.dataset.bigshootPicking === "true");
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
  return {
    downloadId: download.id,
    filename: download.filename,
    png: await decodePng(buffer),
  };
}

async function assertScrollRestored(page, selector, expected) {
  const actual = await waitFor(
    () => page.evaluate((query) => document.querySelector(query).scrollTop, selector),
    (value) => Math.abs(value - expected) <= 1,
  );
  assert(Math.abs(actual - expected) <= 1, `${selector}: scrollTop was not restored (${actual}/${expected}).`);
}

function assertDimensions(result, expectedWidth, expectedHeight, label) {
  assert.equal(result.png.width, expectedWidth, `${label}: wrong PNG width/DPR.`);
  assert.equal(result.png.height, expectedHeight, `${label}: wrong PNG height or cropped content.`);
}

function assertVerticalSequence(result, x, expected, label) {
  const { png } = result;
  assert(x >= 0 && x < png.width, `${label}: sample column is outside the PNG.`);
  const palette = [...new Set(expected.map(({ color }) => color))];
  const runs = [];
  for (let y = 0; y < png.height; y += 1) {
    const color = palette.find((candidate) => colorMatches(pixelAt(png, x, y), hexToRgb(candidate)));
    if (!color) {
      continue;
    }
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
    `${label}: color bands are missing, duplicated, or out of order (${JSON.stringify(significant)}).`,
  );
  significant.forEach((run, index) => {
    const range = expected[index];
    assert(
      run.length >= range.min && run.length <= range.max,
      `${label}: band ${index + 1} has ${run.length}px; expected ${range.min}-${range.max}px.`,
    );
  });
}

function assertColorPixelCount(result, color, maximum, label) {
  const expected = hexToRgb(color);
  let count = 0;
  for (let offset = 0; offset < result.png.data.length; offset += 4) {
    if (colorMatches(
      [result.png.data[offset], result.png.data[offset + 1], result.png.data[offset + 2]],
      expected,
    )) {
      count += 1;
    }
  }
  assert(count <= maximum, `${label}: ${color} appears ${count} times; expected at most ${maximum}.`);
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
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("The downloaded capture is not a PNG file.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels || buffer[24] !== 8 || buffer[26] !== 0 || buffer[27] !== 0) {
    throw new Error("The PNG uses an unsupported pixel format for E2E assertions.");
  }

  const compressed = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      compressed.push(buffer.subarray(offset + 8, offset + 8 + length));
    }
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
    "src/picker.js",
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
    } else {
      await copyFile(source, target);
    }
  }
}
