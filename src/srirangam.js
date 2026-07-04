const SITE = "https://srirangaminfo.com";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function srirangamPageUrl(parts) {
  return `${SITE}/Tamil-daily-calendar.php?date=${parts.dd}/${parts.mm}/${parts.year}`;
}

export function srirangamFallbackImageUrl(parts) {
  return `${SITE}/cal/${parts.year}/${parts.dd}${parts.mm}.jpg`;
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return tag.match(re)?.[2]?.trim() || null;
}

export function extractSrirangamImageSrc(html) {
  const section =
    String(html).match(/<div\b[^>]*\bclass=["'][^"']*\btamilcalendardiv\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i)?.[0] ||
    String(html);
  const tags = section.match(/<img\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const src = attr(tag, "src");
    const klass = attr(tag, "class") || "";
    if (src && /\b(zoomify|img-responsive)\b/i.test(klass) && /^\.?\/?cal\//i.test(src)) {
      return src;
    }
  }

  return null;
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
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) {
    throw new Error(`unexpected content-type "${ct}" for ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 5000) {
    throw new Error(`image only ${buffer.length} bytes for ${imageUrl}`);
  }
  return buffer;
}

export async function downloadSrirangamForParts(parts) {
  const pageUrl = srirangamPageUrl(parts);

  try {
    const pageRes = await fetch(pageUrl, { headers: { "User-Agent": BROWSER_UA } });
    if (!pageRes.ok) throw new Error(`page HTTP ${pageRes.status}`);
    const src = extractSrirangamImageSrc(await pageRes.text());
    if (src) {
      const imageUrl = resolveUrl(src);
      const buffer = await fetchImage(imageUrl, pageUrl);
      return { buffer, url: imageUrl, parts, via: "srirangam-scrape" };
    }
  } catch (e) {
    console.warn(`Srirangam scrape failed for ${parts.label} (${e.message}); trying fallback URL.`);
  }

  const imageUrl = srirangamFallbackImageUrl(parts);
  const buffer = await fetchImage(imageUrl, pageUrl);
  return { buffer, url: imageUrl, parts, via: "srirangam-fallback" };
}
