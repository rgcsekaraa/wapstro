# wapstro

Posts the **Tamil Daily Calendar** image to a WhatsApp group **every day at 00:01 IST**, automatically, via GitHub Actions.

- **Scrapes the site's date-specific page** and downloads whatever `<img>` it actually references — so if the site changes its folder/filename scheme, this keeps working (the old `<year>/<DDMMYYYY>.jpg` pattern is only a fallback). Handles the site's hotlink protection.
- Sends it to **one WhatsApp group** from **your own number** using [Baileys](https://github.com/WhiskeySockets/Baileys).
- Make the group **"Only admins can send messages"** so it acts as a broadcast — nobody else can reply.
- The linked-device session is stored in the `WA_CREDS` repo secret and refreshed after each run.

> ⚠️ **Read this first.** This uses an **unofficial** WhatsApp client (the official Cloud API cannot post to groups). Automating a personal number carries a **risk of being banned by WhatsApp**. Keep volume low (one image/day is fine), and don't use a number you can't afford to lose. You accept this risk by using this.

---

## One-time setup

You need Node 20+ locally and a GitHub repo.

### 1. Install deps
```bash
cd wapstro
npm install
```

### 2. Link your WhatsApp number
```bash
npm run link
```
Scan the QR with **WhatsApp → Settings → Linked devices → Link a device**.
When it finishes it prints a long base64 string — that's your `WA_CREDS`. Copy it.

### 3. Find your group's JID
Create the group in WhatsApp first (add the recipient, then in group settings set
**"Only admins can send messages"**, with you as admin). Then:
```bash
npm run groups
```
Copy the `JID` (ends in `@g.us`) of your target group. It should show `announce-only: yes`.

### 4. Create a GitHub PAT (for the session to persist)
Create a **fine-grained personal access token** scoped to this repo with
**Repository permissions → Secrets: Read and write**. Copy the token.

### 5. Push this repo to GitHub, then add secrets
In the repo: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `WA_CREDS` | the base64 from step 2 |
| `GROUP_JID` | the `@g.us` id from step 3 |
| `GH_PAT` | the token from step 4 |

(Optional) Under the **Variables** tab add `IMAGE_CAPTION`, e.g. `Tamil Calendar {date} 🙏`
(`{date}` is replaced with the day's date).

### 6. Test it
Go to **Actions → "Daily Tamil Calendar to WhatsApp" → Run workflow**.
Check the group received the image. After that it runs automatically every day.

---

## Reliability: the image cache (important)

The site doesn't always have the new day's image live *exactly* at 00:01 IST — but it
publishes future days **ahead of time**. So instead of downloading at midnight, we
**pre-download ~1 year of images** into `images/DDMMYYYY.jpg` and commit them. The
daily job posts from that cache and only falls back to a live download if a date is
missing — so a late/missed site update no longer breaks the daily post.

Fill the cache once locally (then commit it):
```bash
python3 fetch_year.py            # next 365 days -> ./images
git add images && git commit -m "seed image cache"
```
Useful flags: `--days N`, `--out FOLDER`, `--force`, `--delay SECONDS`.

After that, the **Refill image cache** workflow re-runs weekly on GitHub, downloads
newly published days, and commits them automatically — so the ~1-year buffer is
always topped up without you doing anything.

## How it works

| File | Purpose |
|---|---|
| `fetch_year.py` | Pre-downloads ~1 year of images into `images/` (dependency-free). |
| `src/download.js` | Live fetch of the day's image (IST date) via UA + Referer; scrape-first. |
| `src/connect.js` | Opens a Baileys connection from the stored session. |
| `src/send.js` | The daily job: **cache-first** image → post to group → refresh `WA_CREDS`. |
| `src/lib.js` | Session (de)serialization + GitHub secret update (libsodium). |
| `src/link.js` | One-time QR pairing. |
| `src/groups.js` | One-time group-JID lookup. |
| `src/checkPattern.js` | Canary that flags naming-pattern changes. |
| `.github/workflows/daily.yml` | Posts daily — cron `31 18 * * *` UTC = 00:01 IST. |
| `.github/workflows/refill-cache.yml` | Weekly: re-download + commit upcoming images. |
| `.github/workflows/check-pattern.yml` | Weekly: alert if the site's naming changes. |

## Notes & limits

- **Cron timing:** GitHub Actions cron is *best-effort* and can be delayed by minutes (occasionally more). If exact 00:01 matters, this approach can't guarantee it.
- **Re-linking:** If WhatsApp logs out the linked device (rare, but possible after long gaps or a manual unlink), the job fails — just re-run `npm run link` and update the `WA_CREDS` secret.
- **Secret size:** GitHub secrets cap at 64 KB. A single low-volume sender's session stays well under this.
- **Image not yet published:** If the day's image isn't on the site at run time, the job errors out (no message sent) rather than posting a wrong/blank image.
- **Naming-pattern changes:** `send.js` follows whatever `<img src>` the dated page shows, so a rename won't break posting. A separate weekly canary (`.github/workflows/check-pattern.yml`, or `npm run check` locally) compares the live src against the known pattern and **fails (emailing you) if it drifts**, so you can update the fallback/docs.
