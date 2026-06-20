// Cache health alarm:  npm run health
//
// Counts how many consecutive days of images are cached starting from today
// (IST). If the buffer drops below CACHE_MIN_DAYS (default 21), it exits non-zero
// so a scheduled GitHub Action fails and emails you — giving you weeks of warning
// before the daily poster could run out of images (e.g. if the site is slow to
// publish the next year).

import fs from "node:fs";
import path from "node:path";
import { istDateParts } from "./download.js";

const CACHE_DIR = "images";
const MIN_DAYS = parseInt(process.env.CACHE_MIN_DAYS || "21", 10);
const DAY_MS = 24 * 60 * 60 * 1000;

let buffer = 0;
let lastDate = null;
const base = Date.now();

// Walk forward day-by-day until we hit the first missing image.
for (let i = 0; i < 800; i++) {
  const parts = istDateParts(new Date(base + i * DAY_MS));
  const file = path.join(CACHE_DIR, `${parts.ddmmyyyy}.jpg`);
  if (fs.existsSync(file)) {
    buffer = i + 1;
    lastDate = parts.label;
  } else {
    break;
  }
}

const today = istDateParts(new Date(base)).label;
console.log(`Today (IST): ${today}`);
console.log(`Cached buffer: ${buffer} day(s) ahead (through ${lastDate || "—"}).`);
console.log(`Threshold: ${MIN_DAYS} day(s).`);

if (buffer < MIN_DAYS) {
  console.error(
    `\n⚠️  LOW CACHE: only ${buffer} day(s) buffered. ` +
      `Run fetch_year.py — if it reports the next dates as "not published yet", ` +
      `the site hasn't released them and you should keep checking.`
  );
  process.exit(2);
}
console.log("\nCache buffer is healthy.");
