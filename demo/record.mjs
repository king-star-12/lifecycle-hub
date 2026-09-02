/**
 * Records a demo film as one continuous browser session.
 *
 * This is a TEMPLATE. The helpers above the line are reusable; the beat list at
 * the bottom is what you edit per project.
 *
 *   node record.mjs http://localhost:3000 session.webm
 *
 * Reads  timings.json  (how long each beat holds — written by narrate.py)
 * Writes beats.json    (when each beat actually began — needed by mux.py)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const ROOT = process.env.DEMO_DIR ?? process.cwd();
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? path.join(ROOT, "session.webm");
const W = Number(process.env.VIEW_W ?? 1920);
const H = Number(process.env.VIEW_H ?? 1080);
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

const timings = JSON.parse(fs.readFileSync(path.join(ROOT, "timings.json"), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome for Testing — the headless *shell* build cannot screencast. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(cache)) {
    for (const version of fs.readdirSync(cache)) {
      const guess = path.join(cache, version, `chrome-${process.platform === "darwin" ? "mac" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`);
      const mac = path.join(guess, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (fs.existsSync(mac)) return mac;
      const linux = path.join(guess, "chrome");
      if (fs.existsSync(linux)) return linux;
    }
  }
  const system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(system)) return system;
  throw new Error("No Chrome found — set CHROME_PATH");
}

/* ------------------------------------------------------------------ */
/* Injected page helpers                                               */
/* ------------------------------------------------------------------ */

/** Headless Chrome renders no cursor, so draw one the viewer can follow. */
const CURSOR = `
(() => {
  if (window.__cursor) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:22px;height:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))';
  el.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 2l14 8.4-6.1 1.2 3.2 6.6-2.7 1.3-3.2-6.6-4 3.6z" fill="#111" stroke="#fff" stroke-width="1.3"/></svg>';
  document.body.appendChild(el);
  let x = innerWidth * .5, y = innerHeight * .62;
  const put = () => el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  put();
  window.__cursor = {
    async glide(nx, ny, ms) {
      const sx = x, sy = y, t0 = performance.now();
      return new Promise((done) => {
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          const e = p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
          x = sx + (nx - sx) * e; y = sy + (ny - sy) * e; put();
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
    ripple() {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + x + 'px;top:' + y + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:999px;border:2px solid rgba(0,0,0,.5)';
      document.body.appendChild(r);
      r.animate([{transform:'scale(1)',opacity:.9},{transform:'scale(4.2)',opacity:0}],
        {duration:550,easing:'cubic-bezier(.22,1,.36,1)'}).onfinish = () => r.remove();
    }
  };
})();`;

/** Dims everything except a window over what the narrator is discussing. */
const SPOTLIGHT = `
(() => {
  if (window.__spot) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border-radius:14px;opacity:0;transition:opacity .45s ease, all .55s cubic-bezier(.22,1,.36,1);box-shadow:0 0 0 9999px rgba(15,23,42,.34);left:50%;top:50%;width:0;height:0';
  document.body.appendChild(el);
  window.__spot = {
    on(r, pad = 16) {
      el.style.left = (r.left - pad) + 'px'; el.style.top = (r.top - pad) + 'px';
      el.style.width = (r.width + pad*2) + 'px'; el.style.height = (r.height + pad*2) + 'px';
      el.style.opacity = '1';
    },
    off() { el.style.opacity = '0'; }
  };
})();`;

/** Eased scrolling — instant jumps read as cuts and disorient. */
const SCROLLER = `
window.__scrollTo = (top, ms) => new Promise((done) => {
  const start = scrollY, delta = top - start, t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = p < .5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2;
    scrollTo(0, start + delta * e);
    p < 1 ? requestAnimationFrame(step) : done();
  };
  requestAnimationFrame(step);
});
window.__chapterTop = (id, off = 56) => {
  const el = document.getElementById(id);
  return el ? el.getBoundingClientRect().top + scrollY - off : 0;
};`;

/* ------------------------------------------------------------------ */
/* Driving helpers                                                     */
/* ------------------------------------------------------------------ */

export async function dress(page) {
  for (const snippet of [CURSOR, SPOTLIGHT, SCROLLER]) await page.evaluate(snippet);
}

/** Waits until the page has genuinely stopped moving before measuring. */
export async function settle(page, timeout = 3000) {
  const started = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - started < timeout) {
    const y = await page.evaluate(() => Math.round(scrollY));
    stable = y === last ? stable + 100 : 0;
    if (stable >= 300) return;
    last = y;
    await wait(100);
  }
}

export async function clickAt(page, text, { glide = 700 } = {}) {
  const point = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll("button, a, [role=button]")]
      .find((n) => n.textContent.trim().includes(needle));
    if (!el) throw new Error("no clickable element containing: " + needle);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  await page.evaluate((p, ms) => window.__cursor.glide(p.x, p.y, ms), point, glide);
  await wait(glide + 90);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => window.__cursor.ripple());
  await page.mouse.click(point.x, point.y);
  await wait(140);
}

export async function typeInto(page, selector, text, { delay = 26 } = {}) {
  const point = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(260, r.width / 2), y: r.top + 44 };
  }, selector);
  await page.evaluate((p, ms) => window.__cursor.glide(p.x, p.y, ms), point, 800);
  await wait(880);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => window.__cursor.ripple());
  await page.keyboard.type(text, { delay });
}

export async function scrollToChapter(page, id, ms = 1600) {
  await page.evaluate((c, d) => window.__scrollTo(window.__chapterTop(c), d), id, ms);
  await wait(ms + 120);
}

/**
 * Spotlights an element for a while. `finder` runs in the page and returns an
 * element — a function rather than a selector, because the interesting targets
 * usually have no stable class to hang a selector on.
 */
export async function focusOn(page, finderSource, ms, pad = 18) {
  const found = await page.evaluate((src, padding) => {
    const el = new Function("return (" + src + ")()")();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    window.__spot.on({ left: r.left, top: r.top, width: r.width, height: r.height }, padding);
    return true;
  }, finderSource, pad);
  if (!found) return;
  await wait(ms);
  await page.evaluate(() => window.__spot.off());
  await wait(400);
}


/* ---------------- Lifecycle Hub specific helpers ------------------ */

/** Smoothly scrolls the right-hand investigation panel (not the window). */
export async function scrollPanel(page, to, ms = 1200) {
  await page.evaluate(
    (target, dur) =>
      new Promise((done) => {
        const el = [...document.querySelectorAll("aside")].find((a) => a.scrollHeight > a.clientHeight + 40);
        if (!el) return done();
        const from = el.scrollTop;
        const t0 = performance.now();
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          el.scrollTop = from + (target - from) * ease(k);
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    to,
    ms,
  );
  await wait(ms + 120);
}

/** Sets the reconstruction scrubber to a frame index, as a drag would. */
export async function scrubTo(page, index) {
  await page.evaluate((i) => {
    const overlay = document.querySelector(".fixed.inset-0");
    const el = (overlay || document).querySelector('input[type=range]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(i));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, index);
  await wait(260);
}

/** Spotlights an element found by text content within a container. */
export async function focusOnText(page, needle, ms, pad = 16) {
  // Walks text nodes rather than scanning elements. Two reasons: materialising
  // textContent for every div is O(subtree) per node and was costing seconds on
  // this panel, and several labels here are styled uppercase in CSS while the
  // DOM text is sentence case -- so the match has to be case-insensitive and
  // anchored on the text itself, not on a guessed selector.
  return focusOn(
    page,
    `() => {
      const needle = ${JSON.stringify(needle)}.toLowerCase();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || "").trim().toLowerCase();
        if (!text || !text.startsWith(needle)) continue;
        const el = node.parentElement;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        return el.closest("section") || el.parentElement || el;
      }
      return null;
    }`,
    ms,
    pad,
  );
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: "networkidle0" });

const recorder = await page.screencast({ path: OUT, ffmpegPath: FFMPEG });
const t0 = Date.now();
const marks = {};

/**
 * Each beat owns a fixed slice of the timeline. Navigation, clicking and
 * scrolling all happen inside that slice, so overhead never pushes the picture
 * out of step with the voice.
 */
async function beat(id, label, action) {
  const startedAt = Date.now();
  marks[id] = (startedAt - t0) / 1000;
  if (action) await action();
  const spent = (Date.now() - startedAt) / 1000;
  const budget = timings[id] ?? 0;
  const over = spent > budget ? `  \x1b[31mOVER by ${(spent - budget).toFixed(1)}s\x1b[0m` : "";
  console.log(
    `  ${marks[id].toFixed(1).padStart(6)}s  ${label.padEnd(42)} spent ${spent.toFixed(1)}s / ${budget.toFixed(1)}s${over}`,
  );
  const remaining = timings[id] * 1000 - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);
}

try {
  // ================================================================
  // EDIT BELOW — one beat per line of narration, ids matching script.json
  // ================================================================

  await beat("01", "hook — network at rest", async () => {
    await dress(page);
    await wait(900);
    await page.evaluate(() => window.__cursor.glide(960, 520, 1400));
  });

  await beat("02", "the network, and the synthetic-data badge", async () => {
    await focusOnText(page, "Synthetic data", 2200, 12);
    await focusOn(page, "() => document.querySelector('header')", 3200, 8);
  });

  await beat("03", "how utilities prioritise today — the queue", async () => {
    await focusOnText(page, "Priority queue", 3000, 14);
  });

  await beat("04", "open WM-1604", async () => {
    await page.goto(BASE + "/?asset=WM-1604", { waitUntil: "networkidle0" });
    await dress(page);
    await wait(1200);
    await focusOnText(page, "Segment", 3600, 14);
  });

  await beat("05", "the decomposition — nine signals, five families", async () => {
    await scrollPanel(page, 430, 1500);
    await focusOnText(page, "Why this score", 4200, 14);
  });

  await beat("06", "inspection evidence pulled from the PDF", async () => {
    await scrollPanel(page, 1180, 1600);
    await focusOnText(page, "Inspection evidence", 5200, 14);
  });

  await beat("07", "live external context", async () => {
    await scrollPanel(page, 1760, 1300);
    await clickAt(page, "Retrieve external context").catch(() => {});
    await wait(3200);
    await focusOnText(page, "External context", 5000, 14);
  });

  await beat("08", "open the reconstruction", async () => {
    await scrollPanel(page, 0, 900);
    await clickAt(page, "Reconstruct");
    await wait(1500);
    const open = await page.evaluate(() => !!document.querySelector(".fixed.inset-0"));
    if (!open) throw new Error("reconstruction overlay did not open");
  });

  await beat("09", "watch it re-score history", async () => {
    // 26 frames at 260ms is ~6.8s of playback; hold afterwards so the
    // emergence log is readable while the voice names each signal.
    await wait(12200);
  });

  await beat("10", "the crossing, and the rank against age", async () => {
    await scrubTo(page, 13);
    await wait(700);
    await focusOnText(page, "Rank by pipe age", 6200, 18);
  });

  await beat("11", "the honest miss rate", async () => {
    await page.goto(BASE + "/metrics", { waitUntil: "networkidle0" });
    await dress(page);
    await wait(900);
    await focusOnText(page, "Warning lead time", 5200, 16);
  });

  await beat("12", "ranking quality and calibration", async () => {
    await page.evaluate(() => window.__scrollTo(document.body.scrollHeight * 0.42, 1400));
    await wait(1600);
    await focusOnText(page, "Calibration", 6600, 16);
  });

  await beat("13", "close", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    await dress(page);
    await wait(1400);
    await page.evaluate(() => window.__cursor.glide(760, 470, 1600));
    await wait(2400);
  });

  fs.writeFileSync(path.join(ROOT, "beats.json"), JSON.stringify(marks, null, 1));
} finally {
  await recorder.stop();
  await browser.close();
}
console.log(`\nrecorded ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
