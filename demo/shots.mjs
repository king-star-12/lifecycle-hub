/**
 * Gallery stills for the Devpost submission.
 *
 * Devpost renders gallery images at 3:2, so the viewport is 1920x1280 rather
 * than the 16:9 the film used. deviceScaleFactor 2 is safe here in a way it is
 * not while recording: these are single frames, so there is no encoder to
 * starve, and the text is noticeably crisper at 2x.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const BASE = process.argv[2] ?? "http://localhost:3200";
const OUT = path.join(import.meta.dirname, "gallery");
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME, ".cache/puppeteer/chrome");
  for (const dir of fs.readdirSync(root)) {
    const p = path.join(root, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chrome found");
}

/** Smoothly scroll the investigation panel, then let it settle. */
async function panelTo(page, y) {
  await page.evaluate((target) => {
    const el = [...document.querySelectorAll("aside")].find((a) => a.scrollHeight > a.clientHeight + 40);
    if (el) el.scrollTop = target;
  }, y);
  await wait(700);
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--window-size=1920,1280", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1280, deviceScaleFactor: 2 });

const shot = async (name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: "jpeg", quality: 92 });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${name.padEnd(34)} ${kb} KB`);
};

// 1 — the network at a glance
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
await wait(6000);
// The default fit leaves the network small in a 3:2 frame. Zoom in over the
// dense core so the segments carry the image, then let tiles settle again --
// vector tiles re-request on every zoom level.
await page.mouse.move(1110, 700);
await page.mouse.wheel({ deltaY: -420 });
await wait(2500);
await page.mouse.wheel({ deltaY: -260 });
await wait(7000);
// Park the cursor off the network, or the segment under it renders a hover
// tooltip in the corner of the frame.
await page.mouse.move(430, 1150);
await wait(900);
await shot("01-network-map.jpg");

// 2 — one segment, and why it scores what it scores
await page.goto(BASE + "/?asset=WM-1604", { waitUntil: "networkidle0" });
await wait(3800);
await panelTo(page, 300);
await shot("02-risk-decomposition.jpg");

// 3 — document extraction and live external context together
await panelTo(page, 1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Retrieve external context/.test(x.textContent));
  if (b) b.click();
});
await wait(4000);
await panelTo(page, 1620);
await shot("03-evidence-documents-web.jpg");

// 4 — the reconstruction, parked on the day it crossed the threshold
await panelTo(page, 0);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Reconstruct/.test(x.textContent));
  if (b) b.click();
});
await wait(2500);
// Let it play out, then park on T-96: the frame where it crosses.
await wait(8000);
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const el = (overlay || document).querySelector("input[type=range]");
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, "13");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await wait(1200);
await shot("04-failure-reconstruction.jpg");

// 5 — the evaluation, including what it gets wrong
await page.goto(BASE + "/metrics", { waitUntil: "networkidle0" });
await wait(2500);
await shot("05-evaluation-backtest.jpg");

await browser.close();
console.log("\ngallery written to demo/gallery/");
