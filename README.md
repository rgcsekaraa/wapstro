# wapstro

Posts Tamil calendar images to a WhatsApp group. For **exact 00:01 IST** delivery,
run the always-on bot on a VM; GitHub Actions scheduled workflows are only
best-effort and can be delayed.

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

## On-demand WhatsApp commands

For `/date` and `/range` replies, the bot must stay connected to WhatsApp. A
scheduled one-shot workflow can post the daily image, but it cannot receive
messages while it is not running.

Supported personal-chat commands:
```text
/date 24-05-2026
/24-05-2026
/range 24-05-2026 29-05-2026
/help
```

The bot ignores groups, broadcasts, status, and ordinary non-command chat. Set
`ALLOWED_SENDERS` to a comma-separated list of phone numbers if only specific
people should be able to request images.

### Free always-on option

Use an Always Free Linux VM, such as Oracle Cloud Always Free, and run:
```bash
git clone <your-repo-url> wapstro
cd wapstro
npm ci
npm run link
BOT_DAILY_ENABLED=true GROUP_JID="120363...@g.us" npm run bot
```

For a long-running service, keep the process alive with `systemd`, `pm2`, or
`tmux`. Required environment variables:

| Variable | Purpose |
|---|---|
| `GROUP_JID` | Target WhatsApp group for the daily 00:01 IST post. |
| `IMAGE_CAPTION` | Optional caption for the first image. `{date}` is replaced. |
| `SRIRANGAM_IMAGE_CAPTION` | Optional caption for the Srirangam image. `{date}` is replaced. |
| `ALLOWED_SENDERS` | Optional comma-separated personal numbers allowed to use commands. |
| `BOT_DAILY_ENABLED` | Set to `true` on the exact-time VM. Disable the GitHub daily schedule to avoid duplicate posts. |
| `BOT_DAILY_CATCH_UP` | Keep `false` for strict timing. Set `true` only if late catch-up posts are acceptable after downtime. |
| `WA_ENC_KEY` | Optional 64-character hex key if you want encrypted session snapshots. |
| `WA_CREDS` | Optional bootstrap session if `auth/` is not already present. |

For exact delivery, the VM service must be the daily sender. Disable the scheduled
trigger in `.github/workflows/daily.yml` after the VM is confirmed running;
otherwise GitHub can still send a delayed duplicate.

There is also `.github/workflows/bot.yml`, but using GitHub Actions as an
always-on host is not a good long-term free solution. Use a VM for command
replies if you want this to be reliable and policy-safe.

### Heartbeat for sleeping hosts

`npm run bot` can expose a lightweight health endpoint for hosts such as
Hugging Face Spaces or Koyeb:

```bash
PORT=7860 BOT_DAILY_ENABLED=false GROUP_JID="120363...@g.us" npm run bot
```

Health URL:
```text
https://your-host.example/health
```

To keep a sleeping host warm, add a GitHub Actions repository variable:

| Variable | Value |
|---|---|
| `HEARTBEAT_URL` | `https://your-host.example/health` |

The **Keep bot host awake** workflow runs every 6 hours and calls
`npm run heartbeat`. For Hugging Face Spaces free CPU hardware, this is enough
to stay below the documented idle sleep window, but an external monitor like
UptimeRobot at 5-10 minute intervals is still more responsive.

### Oracle VM service setup

After creating an Oracle Always Free Ubuntu VM and opening SSH, run this on the
VM:

```bash
git clone <your-repo-url> wapstro
cd wapstro
sudo bash deploy/oracle-vm-setup.sh <your-repo-url>
```

Then edit the service environment:
```bash
sudo nano /etc/wapstro.env
```

If the VM does not already have `auth/` restored from `WA_CREDS`, link WhatsApp
on the VM:

```bash
sudo -iu wapstro
cd /opt/wapstro
npm run link
exit
```

Start and inspect the service:

```bash
sudo systemctl enable --now wapstro
journalctl -u wapstro -f
```

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
