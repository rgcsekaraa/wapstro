#!/usr/bin/env python3
"""
Pre-download Tamil Daily Calendar images for the next N days (default 365) into a
local cache, so the daily WhatsApp job never depends on the site updating exactly
at 00:01 IST.

Why: the site publishes images ahead of time, but the new day's image isn't
guaranteed to be live precisely at midnight. Caching a year in advance removes
that risk entirely. Re-run this every few months to top up.

Resilient to naming/folder changes: for each date it fetches the date-specific
calendar page and downloads whatever <img class="img-responsive"> actually
points to, falling back to the known YYYY/DDMMYYYY.jpg pattern only if needed.

Usage:
  python3 fetch_year.py                  # next 365 days into ./images
  python3 fetch_year.py --days 30        # just the next 30 days
  python3 fetch_year.py --out images     # output folder (default: images)
  python3 fetch_year.py --force          # re-download even if cached
  python3 fetch_year.py --delay 0.5      # seconds between requests (be polite)

Cache layout: images/DDMMYYYY.jpg  (matches what src/send.js looks for)
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

SITE = "https://www.tamildailycalendar.com"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
IST = timezone(timedelta(hours=5, minutes=30))
IMG_RE = re.compile(
    r'<img\b[^>]*\bclass="[^"]*\bimg-responsive\b[^"]*"[^>]*>', re.IGNORECASE
)
SRC_RE = re.compile(r'\bsrc="([^"]+)"', re.IGNORECASE)


def dated_page_url(d):
    return (
        f"{SITE}/tamil_daily_calendar.php"
        f"?day={d.day}&month={d.month:02d}&year={d.year}&msg=Tamil%20Calendar%20Today"
    )


def fallback_image_url(d):
    return f"{SITE}/{d.year}/{d.strftime('%d%m%Y')}.jpg"


def http_get(url, referer=None, timeout=30):
    headers = {"User-Agent": BROWSER_UA}
    if referer:
        headers["Referer"] = referer
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.geturl(), resp.read()


def extract_src(html):
    tag = IMG_RE.search(html)
    if not tag:
        return None
    m = SRC_RE.search(tag.group(0))
    if not m:
        return None
    val = m.group(1).strip()
    if not val or "noimage" in val.lower():
        return None
    return val


def resolve(src):
    if re.match(r"^https?://", src, re.IGNORECASE):
        return src
    return f"{SITE}/{src.lstrip('./')}"


def is_jpeg(data):
    return len(data) >= 5000 and data[:3] == b"\xff\xd8\xff"


def fetch_one(d):
    """Returns (data_bytes, source_url) or raises Exception if unavailable."""
    page = dated_page_url(d)
    # 1) Preferred: scrape the dated page for the real image URL.
    try:
        _, html = http_get(page)
        src = extract_src(html.decode("latin-1", errors="ignore"))
        if src:
            image_url = resolve(src)
            final_url, data = http_get(image_url, referer=page)
            if "NoHotLinking" not in final_url and is_jpeg(data):
                return data, image_url
    except (URLError, HTTPError, TimeoutError):
        pass
    # 2) Fallback: the known direct pattern.
    image_url = fallback_image_url(d)
    try:
        final_url, data = http_get(image_url, referer=page)
    except HTTPError as e:
        # A 404 on a future date just means the site hasn't published it yet —
        # that's expected, not a hard error.
        if e.code == 404:
            raise RuntimeError("not published yet (404)")
        raise
    if "NoHotLinking" in final_url:
        raise RuntimeError("not published yet (hotlink)")
    if not is_jpeg(data):
        raise RuntimeError("not published yet (invalid JPEG)")
    return data, image_url


def main():
    ap = argparse.ArgumentParser(description="Pre-download a year of calendar images.")
    ap.add_argument("--days", type=int, default=365, help="how many days to fetch (default 365)")
    ap.add_argument("--out", default="images", help="output folder (default: images)")
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    ap.add_argument("--delay", type=float, default=0.3, help="seconds between requests")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    start = datetime.now(IST).date()

    downloaded = skipped = 0
    missing = []
    failed = []

    print(f"Fetching {args.days} day(s) from {start.isoformat()} (IST) into ./{args.out}/\n")

    for i in range(args.days):
        d = start + timedelta(days=i)
        name = d.strftime("%d%m%Y") + ".jpg"
        path = os.path.join(args.out, name)

        if os.path.exists(path) and not args.force:
            skipped += 1
            continue

        try:
            data, src_url = fetch_one(d)
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            downloaded += 1
            print(f"  ✓ {d.isoformat()}  {len(data):>7} bytes  {src_url}")
        except Exception as e:  # noqa: BLE001 - want to keep going on any failure
            msg = str(e)
            if "not published" in msg:
                missing.append(d.isoformat())
                print(f"  · {d.isoformat()}  not available yet ({msg})")
            else:
                failed.append((d.isoformat(), msg))
                print(f"  ✗ {d.isoformat()}  ERROR: {msg}")

        if args.delay:
            time.sleep(args.delay)

    print("\n" + "=" * 60)
    print(f"Downloaded: {downloaded}   Already cached: {skipped}")
    print(f"Not published yet: {len(missing)}   Errors: {len(failed)}")
    if missing:
        print("\nNot yet published (re-run later to pick these up):")
        for dt in missing:
            print(f"  - {dt}")
    if failed:
        print("\nErrors:")
        for dt, msg in failed:
            print(f"  - {dt}: {msg}")

    # Non-zero exit only on hard errors, so cron/CI can alert. Missing-future
    # images are expected and don't fail the run.
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
