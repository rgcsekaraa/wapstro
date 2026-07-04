// Downloads the Tamil Daily Calendar image for any date.
//
// Robust against the site changing its image-naming/folder scheme: instead of
// only guessing the URL, we fetch the *date-specific* calendar page and read
// whatever <img class="img-responsive"> the site actually references, then
// download that. We only fall back to the known pattern if scraping fails.
//
// The site has hotlink protection: requests need a browser User-Agent AND a
// Referer header pointing at the calendar page, or it 302s to NoHotLinking.jpg.

const SITE = "https://www.tamildailycalendar.com";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Build a normalized date-parts object from day/month/year numbers.
export function partsFor(day, month, year) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);
  return {
    day: Number(day), // unpadded, matches the site's ?day= links
    mm,
    dd,
    year: yyyy,
    ddmmyyyy: `${dd}${mm}${yyyy}`,
    label: `${dd}-${mm}-${yyyy}`,
  };
}

// Date parts for "now" in IST (UTC+5:30), independent of the runner's timezone.
export function istDateParts(now = new Date()) {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return partsFor(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
}

// The date-specific page that authoritatively references that day's image.
export function datedPageUrl(parts) {
  return `${SITE}/tamil_daily_calendar.php?day=${parts.day}&month=${parts.mm}&year=${parts.year}&msg=Tamil%20Calendar%20Today`;
}

export function fallbackImageUrls(parts) {
  const unpaddedDay = `${SITE}/${parts.year}/${parts.day}${parts.mm}${parts.year}.jpg`;
  const padded = `${SITE}/${parts.year}/${parts.ddmmyyyy}.jpg`;
  return [...new Set([unpaddedDay, padded])];
}

export function knownImageSrcs(parts) {
  return fallbackImageUrls(parts).map((url) => url.replace(`${SITE}/`, ""));
}

// The direct image URL, used only as a fallback.
export function fallbackImageUrl(parts) {
  return fallbackImageUrls(parts)[0];
}

// Pulls the main calendar image src out of the page HTML.
export function extractMainImageSrc(html) {
  const tag = html.match(/<img\b[^>]*\bclass="[^"]*\bimg-responsive\b[^"]*"[^>]*>/i);
  if (!tag) return null;
  const src = tag[0].match(/\bsrc="([^"]+)"/i);
  if (!src) return null;
  const value = src[1].trim();
  if (!value || /noimage/i.test(value)) return null;
  return value;
}

function resolveUrl(src) {
  if (/^https?:\/\//i.test(src)) return src;
  return `${SITE}/${src.replace(/^\.?\//, "")}`;
}

async function fetchImage(imageUrl, referer) {
  const res = await fetch(imageUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: referer,
      Accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);
  if (res.url.includes("NoHotLinking")) {
    throw new Error(`not published (hotlink protection, redirected to ${res.url})`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) {
    throw new Error(`not published (unexpected content-type "${ct}")`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) {
    throw new Error(`not published (image only ${buf.length} bytes)`);
  }
  return buf;
}

// Live-download the calendar image for the given parts. Throws if unavailable.
// Returns { buffer, url, parts, via, patternChanged }.
export async function downloadForParts(parts) {
  const pageUrl = datedPageUrl(parts);

  // 1) Preferred: scrape the dated page for the real image URL.
  try {
    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": BROWSER_UA } });
    if (!pageRes.ok) throw new Error(`page HTTP ${pageRes.status}`);
    const html = await pageRes.text();
    const src = extractMainImageSrc(html);
    if (src) {
      const imageUrl = resolveUrl(src);
      const patternChanged = !src.includes(parts.ddmmyyyy);
      if (patternChanged) {
        console.warn(
          `⚠️  Naming pattern changed for ${parts.label}: page references "${src}". Following it anyway.`
        );
      }
      const buffer = await fetchImage(imageUrl, pageUrl);
      return { buffer, url: imageUrl, parts, via: "scrape", patternChanged };
    }
  } catch (e) {
    console.warn(`⚠️  Scrape failed for ${parts.label} (${e.message}); trying fallback URL.`);
  }

  // 2) Fallback: try known direct patterns.
  let lastError = null;
  for (const imageUrl of fallbackImageUrls(parts)) {
    try {
      const buffer = await fetchImage(imageUrl, pageUrl);
      return { buffer, url: imageUrl, parts, via: "fallback", patternChanged: false };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Convenience: live-download for "today" (IST).
export async function downloadCalendarImage(now = new Date()) {
  return downloadForParts(istDateParts(now));
}
