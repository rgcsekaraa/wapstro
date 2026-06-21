const urls = (process.env.HEARTBEAT_URLS || process.env.HEARTBEAT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const timeoutMs = parseInt(process.env.HEARTBEAT_TIMEOUT_MS || "15000", 10);

if (urls.length === 0) {
  console.log("No HEARTBEAT_URL or HEARTBEAT_URLS set; nothing to ping.");
  process.exit(0);
}

let failures = 0;

for (const url of urls) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "wapstro-heartbeat/1.0",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      failures += 1;
      console.error(`${url} -> HTTP ${res.status}`);
      continue;
    }

    const text = await res.text();
    console.log(`${url} -> ${res.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (e) {
    failures += 1;
    console.error(`${url} -> ${e.message}`);
  }
}

if (failures > 0) process.exit(1);
