// Pattern watcher:  npm run check
//
// Fetches the date-specific calendar page for the next few days and compares the
// real <img> src against the expected "YYYY/DDMMYYYY.jpg" pattern. Exits with a
// non-zero code if the site has changed its naming scheme (or the page can't be
// parsed) — so a scheduled GitHub Action can notify you before the daily job
// silently relies on stale assumptions.
//
// Note: send.js does NOT depend on this — it already follows whatever src the
// page references. This is an early-warning canary so you can update docs/logic.

import {
  istDateParts,
  datedPageUrl,
  extractMainImageSrc,
  knownImageSrcs,
} from "./download.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  let changed = false;
  let failures = 0;

  for (let i = 0; i < 3; i++) {
    const parts = istDateParts(new Date(Date.now() + i * DAY_MS));
    const pageUrl = datedPageUrl(parts);
    const expected = knownImageSrcs(parts);

    try {
      const res = await fetch(pageUrl, { headers: { "User-Agent": BROWSER_UA } });
      if (!res.ok) throw new Error(`page HTTP ${res.status}`);
      const src = extractMainImageSrc(await res.text());

      if (!src) {
        console.error(`✗ ${parts.label}: no img-responsive src found on the page.`);
        failures++;
        continue;
      }
      if (expected.includes(src)) {
        console.log(`✓ ${parts.label}: src "${src}" matches expected pattern.`);
      } else {
        console.warn(`⚠ ${parts.label}: PATTERN CHANGED. expected one of ${expected.join(", ")}, got "${src}".`);
        changed = true;
      }
    } catch (e) {
      console.error(`✗ ${parts.label}: ${e.message}`);
      failures++;
    }
  }

  if (changed) {
    console.error(
      "\nNaming pattern changed. send.js will keep working (it follows the page's src), " +
        "but update README/fallback in src/download.js to match the new scheme."
    );
    process.exit(2);
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed (page unreachable/unparseable).`);
    process.exit(1);
  }
  console.log("\nAll good: naming pattern unchanged.");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
