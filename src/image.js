// Cache-first image resolver, shared by the daily post and the command bot.
// Returns the pre-downloaded image for a date if present (images/DDMMYYYY.jpg),
// otherwise live-downloads it. Throws if the date isn't available anywhere.

import fs from "node:fs";
import path from "node:path";
import { downloadForParts } from "./download.js";

const CACHE_DIR = "images";

function isJpeg(buf) {
  return buf.length >= 5000 && buf.slice(0, 3).toString("hex") === "ffd8ff";
}

// Strip em/en dashes (and minus sign) from captions -> plain hyphen, per the
// requirement that no caption contain an em-dash.
export function cleanCaption(s) {
  return String(s).replace(/[‒–—―−]/g, "-");
}

// parts -> { buffer, url, parts, via }
export async function getImage(parts) {
  const cached = path.join(CACHE_DIR, `${parts.ddmmyyyy}.jpg`);
  if (fs.existsSync(cached)) {
    const buffer = fs.readFileSync(cached);
    if (isJpeg(buffer)) return { buffer, url: cached, parts, via: "cache" };
  }
  // Not cached (or cache invalid) -> live download (works for any published date).
  return downloadForParts(parts);
}
