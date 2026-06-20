// Downloads the Tamil Daily Calendar image for the current IST date.
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

// Date parts for "now" in IST (UTC+5:30), independent of the runner's timezone.
export function istDateParts(now = new Date()) {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  const day = d.getUTCDate(); // unpadded, matches the site's ?day= links
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return { day, mm, dd, year: yyyy, ddmmyyyy: `${dd}${mm}${yyyy}`, label: `${dd}-${mm}-${yyyy}` };
}

// The date-specific page that authoritatively references that day's image.
export function datedPageUrl(parts) {
  return `${SITE}/tamil_daily_calendar.php?day=${parts.day}&month=${parts.mm}&year=${parts.year}&msg=Tamil%20Calendar%20Today`;
}

// The historically-known direct image URL — used only as a fallback.
export function fallbackImageUrl(parts) {
  return `${SITE}/${parts.year}/${parts.ddmmyyyy}.jpg`;
}

// Pulls the main calendar image src out of the page HTML.
export function extractMainImageSrc(html) {
  // The main image carries class="img-responsive". Match that <img ...> tag,
  // then read its src. Order of attributes is irrelevant.
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
    throw new Error(`Hotlink protection triggered (redirected to ${res.url}).`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) {
    throw new Error(`Unexpected content-type "${ct}" for ${imageUrl}.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) {
    throw new Error(`Image suspiciously small (${buf.length} bytes) for ${imageUrl}.`);
  }
  return buf;
}

// Returns { buffer, url, parts, via, patternChanged }.
export async function downloadCalendarImage(now = new Date()) {
  const parts = istDateParts(now);
  const pageUrl = datedPageUrl(parts);

  // 1) Preferred: scrape the dated page for the real image URL.
  try {
    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": BROWSER_UA } });
    if (!pageRes.ok) throw new Error(`page HTTP ${pageRes.status}`);
    const html = await pageRes.text();
    const src = extractMainImageSrc(html);
    if (src) {
      const imageUrl = resolveUrl(src);
      // Note (don't block) if the naming no longer contains today's DDMMYYYY:
      // we still trust the scraped src, but surface that the pattern shifted.
      const patternChanged = !src.includes(parts.ddmmyyyy);
      if (patternChanged) {
        console.warn(
          `⚠️  Naming pattern changed: page references "${src}" (expected something with ${parts.ddmmyyyy}). ` +
            `Following the page's src anyway.`
        );
      }
      const buffer = await fetchImage(imageUrl, pageUrl);
      return { buffer, url: imageUrl, parts, via: "scrape", patternChanged };
    }
    console.warn("⚠️  Could not find img-responsive src on the dated page; using fallback URL.");
  } catch (e) {
    console.warn(`⚠️  Scraping the dated page failed (${e.message}); using fallback URL.`);
  }

  // 2) Fallback: the known direct pattern.
  const imageUrl = fallbackImageUrl(parts);
  const buffer = await fetchImage(imageUrl, datedPageUrl(parts));
  return { buffer, url: imageUrl, parts, via: "fallback", patternChanged: false };
}
