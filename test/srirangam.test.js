import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadSrirangamForParts,
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

test("rejects Srirangam's not.jpg placeholder", () => {
  const html = `
    <div class="tamilcalendardiv">
      <img src="cal/not.jpg" class="img-responsive zoomify">
    </div>
  `;
  assert.equal(extractSrirangamImageSrc(html), null);
});

test("builds date-specific Srirangam page and fallback image URLs", () => {
  const parts = partsFor(4, 7, 2026);

  assert.equal(
    srirangamPageUrl(parts),
    "https://srirangaminfo.com/Tamil-daily-calendar.php?date=04/07/2026"
  );
  assert.equal(srirangamFallbackImageUrl(parts), "https://srirangaminfo.com/cal/2026/0407.jpg");
});

test("retries transient 415 responses from both the page and image", async () => {
  const parts = partsFor(4, 7, 2026);
  const waits = [];
  const warnings = [];
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1 || call === 3) return new Response("blocked", { status: 415 });
    if (call === 2) {
      return new Response(
        '<div class="tamilcalendardiv"><img src="cal/2026/0407.jpg" class="img-responsive zoomify"></div>',
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }
    return new Response(Buffer.alloc(6000), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };

  const result = await downloadSrirangamForParts(parts, {
    fetchImpl,
    retryDelaysMs: [10],
    sleep: async (ms) => waits.push(ms),
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.equal(call, 4);
  assert.deepEqual(waits, [10, 10]);
  assert.equal(warnings.length, 2);
  assert.equal(result.via, "srirangam-scrape");
  assert.equal(result.buffer.length, 6000);
});

test("does not retry a genuine missing image response", async () => {
  const parts = partsFor(4, 7, 2026);
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return new Response("missing", { status: 404 });
  };

  await assert.rejects(
    downloadSrirangamForParts(parts, {
      fetchImpl,
      retryDelaysMs: [0, 0],
      sleep: async () => {},
      logger: { warn: () => {} },
    }),
    /image HTTP 404/
  );
  // One page attempt, then canonical and www direct fallbacks. None is retried.
  assert.equal(call, 3);
});

test("uses the www host when the canonical host is rejected", async () => {
  const parts = partsFor(4, 7, 2026);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return new Response("<html>temporary challenge</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (urls.length === 2) return new Response("blocked", { status: 415 });
    return new Response(Buffer.alloc(6000), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };

  const result = await downloadSrirangamForParts(parts, {
    fetchImpl,
    retryDelaysMs: [],
    sleep: async () => {},
    logger: { warn: () => {} },
  });

  assert.equal(result.via, "srirangam-fallback-www");
  assert.match(result.url, /^https:\/\/www\.srirangaminfo\.com\//);
  assert.equal(urls.length, 3);
});
