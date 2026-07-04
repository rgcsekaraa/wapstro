import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSrirangamImageSrc,
  srirangamFallbackImageUrl,
  srirangamPageUrl,
} from "../src/srirangam.js";
import { partsFor } from "../src/download.js";

test("extracts the daily Srirangam calendar image from the calendar section", () => {
  const html = `
    <div class="Tamil-daily-calendar_section">
      <div class="tamilcalendardiv">
        <img src="cal/2026/0407.jpg" alt="Tamil daily Calendar, Tamil Calendar" class="img-responsive zoomify">
      </div>
    </div>
  `;

  assert.equal(extractSrirangamImageSrc(html), "cal/2026/0407.jpg");
});

test("builds date-specific Srirangam page and fallback image URLs", () => {
  const parts = partsFor(4, 7, 2026);

  assert.equal(
    srirangamPageUrl(parts),
    "https://srirangaminfo.com/Tamil-daily-calendar.php?date=04/07/2026"
  );
  assert.equal(srirangamFallbackImageUrl(parts), "https://srirangaminfo.com/cal/2026/0407.jpg");
});
