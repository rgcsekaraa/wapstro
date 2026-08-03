const SITE = "https://srirangaminfo.com";
const ALTERNATE_SITE = "https://www.srirangaminfo.com";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 15000];

const PAGE_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

export function srirangamPageUrl(parts) {
  return `${SITE}/Tamil-daily-calendar.php?date=${parts.dd}/${parts.mm}/${parts.year}`;
}

export function srirangamFallbackImageUrl(parts) {
  return `${SITE}/cal/${parts.year}/${parts.dd}${parts.mm}.jpg`;
}

function srirangamFallbackImageUrls(parts) {
  const path = `/cal/${parts.year}/${parts.dd}${parts.mm}.jpg`;
  return [`${SITE}${path}`, `${ALTERNATE_SITE}${path}`];
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
    const isPlaceholder = /(?:^|\/)not\.jpg(?:$|[?#])/i.test(src || "");
    if (
      src &&
      !isPlaceholder &&
      /\b(zoomify|img-responsive)\b/i.test(klass) &&
      /^\.?\/?cal\//i.test(src)
    ) {
      return src;
    }
  }

  return null;
}

function resolveUrl(src) {
  if (/^https?:\/\//i.test(src)) return src;
  return `${SITE}/${src.replace(/^\.?\//, "")}`;
}

function httpError(label, res, url) {
  const error = new Error(`${label} HTTP ${res.status} for ${url}`);
  error.status = res.status;
  // Srirangam's origin intermittently returns 415 to GitHub-hosted runners.
  // 403/408/415/425/429 and server errors are safe to retry; a real 404 is not.
  error.retryable =
    [403, 408, 415, 425, 429].includes(res.status) || (res.status >= 500 && res.status <= 599);
  return error;
}

export async function probeSrirangamForParts(
  parts,
  {
    fetchImpl = globalThis.fetch,
    retryDelaysMs = [250, 1000],
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger = { warn: () => {} },
  } = {}
) {
  const options = { fetchImpl, retryDelaysMs, sleep, logger };
  const fallbackUrls = srirangamFallbackImageUrls(parts);

  for (const [index, imageUrl] of fallbackUrls.entries()) {
    try {
      const res = await withRetries(
        async () => {
          const response = await fetchImpl(imageUrl, {
            method: "HEAD",
            redirect: "follow",
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
            },
          });
          if (!response.ok) throw httpError("image", response, imageUrl);
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.startsWith("image/")) {
            const error = new Error(`unexpected content-type "${contentType}" for ${imageUrl}`);
            error.retryable = true;
            throw error;
          }
          return response;
        },
        "Srirangam image probe",
        options
      );
      return {
        available: true,
        status: res.status,
        url: imageUrl,
        contentType: res.headers.get("content-type") || "",
        contentLength: Number(res.headers.get("content-length") || 0),
      };
    } catch (error) {
      // A 404 is authoritative and both hostnames serve the same files.
      if (error.status === 404) {
        return { available: false, status: 404, url: imageUrl, reason: error.message };
      }
      if (index === fallbackUrls.length - 1) throw error;
    }
  }
}

async function withRetries(operation, label, options) {
  const { retryDelaysMs, sleep, logger } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (error.retryable === false || delayMs === undefined) throw error;
      logger.warn(
        `${label} attempt ${attempt + 1} failed (${error.message}); ` +
          `retrying in ${Math.round(delayMs / 1000)}s.`
      );
      await sleep(delayMs);
    }
  }
}

async function fetchPageImageSrc(pageUrl, options) {
  return withRetries(
    async () => {
      const res = await options.fetchImpl(pageUrl, {
        redirect: "follow",
        headers: PAGE_HEADERS,
      });
      if (!res.ok) throw httpError("page", res, pageUrl);
      const src = extractSrirangamImageSrc(await res.text());
      if (!src) {
        const error = new Error(`page did not contain the calendar image for ${pageUrl}`);
        error.retryable = true;
        throw error;
      }
      return src;
    },
    "Srirangam page",
    options
  );
}

async function fetchImage(imageUrl, referer, options) {
  return withRetries(
    async () => {
      const res = await options.fetchImpl(imageUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: referer,
          Accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (!res.ok) throw httpError("image", res, imageUrl);
      const ct = res.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) {
        const error = new Error(`unexpected content-type "${ct}" for ${imageUrl}`);
        error.retryable = true;
        throw error;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 5000) {
        const error = new Error(`image only ${buffer.length} bytes for ${imageUrl}`);
        error.retryable = true;
        throw error;
      }
      return buffer;
    },
    "Srirangam image",
    options
  );
}

export async function downloadSrirangamForParts(
  parts,
  {
    fetchImpl = globalThis.fetch,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger = console,
  } = {}
) {
  const pageUrl = srirangamPageUrl(parts);
  const options = { fetchImpl, retryDelaysMs, sleep, logger };

  try {
    const src = await fetchPageImageSrc(pageUrl, options);
    const imageUrl = resolveUrl(src);
    const buffer = await fetchImage(imageUrl, pageUrl, options);
    return { buffer, url: imageUrl, parts, via: "srirangam-scrape" };
  } catch (e) {
    logger.warn(`Srirangam scrape failed for ${parts.label} (${e.message}); trying fallback URL.`);
  }

  const fallbackUrls = srirangamFallbackImageUrls(parts);
  for (const [index, imageUrl] of fallbackUrls.entries()) {
    try {
      const buffer = await fetchImage(imageUrl, pageUrl, options);
      const via = imageUrl.startsWith(ALTERNATE_SITE)
        ? "srirangam-fallback-www"
        : "srirangam-fallback";
      return { buffer, url: imageUrl, parts, via };
    } catch (error) {
      if (index === fallbackUrls.length - 1) throw error;
      logger.warn(`Srirangam direct download failed (${error.message}); trying alternate host.`);
    }
  }
}
