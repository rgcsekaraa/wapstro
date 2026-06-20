// Always-on WhatsApp bot:
//   1) Posts the daily Raasi Palan image to GROUP_JID at 00:01 IST.
//   2) Answers on-demand requests in personal chats:
//        /24-05-2026                       -> that day's calendar image
//        /range 24-05-2026 29-05-2026      -> an image per day in the range
//        /help                             -> usage
//      Anything malformed gets a helpful reply (it does not stay silent).
//
// No caption ever contains an em/en dash (see cleanCaption()).
//
// Run:  npm run bot                 (forever; for a VM / your own machine)
//       RUN_MINUTES=330 npm run bot (time-boxed; for the GitHub Actions cycle)

import fs from "node:fs";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import cron from "node-cron";
import { partsFor, istDateParts } from "./download.js";
import { getImage, cleanCaption } from "./image.js";
import { AUTH_DIR, restoreAuthDir, dumpAuthDir } from "./lib.js";
import { interpret, partsToUTC, HELP } from "./commands.js";
import { encryptSession, loadCredsBase64, STATE_DIR } from "./session.js";

const logger = pino({ level: "fatal" });
const TZ = "Asia/Kolkata";
const SEND_GAP_MS = 1500; // polite gap between range images
const DAILY_STATE = `${STATE_DIR}/last-daily.txt`;

// If set (>0), run for that many minutes then exit cleanly. Used by the GitHub
// Actions cycle (job runs ~5.5h, exits, next cycle takes over). 0 = run forever.
const RUN_MINUTES = parseInt(process.env.RUN_MINUTES || "0", 10);

const { WA_CREDS, WA_ENC_KEY } = process.env;
const GROUP_JID = process.env.GROUP_JID || "";
// Optional allowlist of phone numbers (digits only, comma-separated). Empty = any
// personal chat may use the commands.
const ALLOWED = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.replace(/\D/g, ""))
  .filter(Boolean);

// De-dupe message IDs within a process run (queued messages can be redelivered).
const seenIds = new Set();

// ---- helpers -------------------------------------------------------------

function senderNumber(jid) {
  return (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isAllowed(jid) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(senderNumber(jid));
}

function messageText(m) {
  let msg = m.message || {};
  // unwrap disappearing / view-once / caption wrappers
  msg =
    msg.ephemeralMessage?.message ||
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.documentWithCaptionMessage?.message ||
    msg;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    ""
  ).trim();
}

// A personal (non-group, non-broadcast) chat. Accepts both @s.whatsapp.net and
// the newer @lid identifiers that current WhatsApp uses for some 1:1 chats.
function isPersonalChat(jid) {
  return (
    jid &&
    !jid.endsWith("@g.us") &&
    !jid.endsWith("@broadcast") &&
    jid !== "status@broadcast" &&
    !jid.endsWith("@newsletter")
  );
}

// Bootstrap the auth folder from the encrypted file / WA_CREDS secret if it isn't
// already present on disk (the Actions runner starts with no auth/ folder).
function ensureSession() {
  if (fs.existsSync(`${AUTH_DIR}/creds.json`)) return true;
  const creds = loadCredsBase64(WA_ENC_KEY, WA_CREDS);
  if (!creds) return false;
  restoreAuthDir(creds, AUTH_DIR);
  console.log("Bootstrapped session from secret/encrypted file.");
  return true;
}

// Persist the current session to the encrypted file so the workflow can commit
// it for the next cycle. No-op without a key (e.g. running locally on a VM).
function persistSession() {
  if (!WA_ENC_KEY) return;
  try {
    encryptSession(dumpAuthDir(AUTH_DIR), WA_ENC_KEY);
  } catch (e) {
    console.error(`persistSession failed: ${e.message}`);
  }
}

function alreadyPostedToday() {
  try {
    return fs.readFileSync(DAILY_STATE, "utf8").trim() === istDateParts().label;
  } catch {
    return false;
  }
}

function markPostedToday() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(DAILY_STATE, `${istDateParts().label}\n`);
}

// ---- sending -------------------------------------------------------------

async function sendImageFor(sock, jid, parts) {
  try {
    const { buffer } = await getImage(parts);
    await sock.sendMessage(jid, {
      image: buffer,
      caption: cleanCaption(`Raasi Palan ${parts.label}`),
    });
    return true;
  } catch (e) {
    await sock.sendMessage(jid, {
      text: cleanCaption(`No calendar found for ${parts.label} (it may not be published yet).`),
    });
    console.warn(`send failed for ${parts.label}: ${e.message}`);
    return false;
  }
}

async function handleCommand(sock, jid, action) {
  if (action.type === "help") {
    await sock.sendMessage(jid, { text: HELP });
    return;
  }
  if (action.type === "error") {
    await sock.sendMessage(jid, { text: cleanCaption(action.message) });
    return;
  }
  if (action.type === "single") {
    await sendImageFor(sock, jid, action.parts);
    return;
  }
  if (action.type === "range") {
    await sock.sendMessage(jid, {
      text: cleanCaption(`Sending ${action.days} day(s): ${action.start.label} to ${action.end.label}...`),
    });
    for (let t = partsToUTC(action.start); t <= partsToUTC(action.end); t += 86400000) {
      const d = new Date(t);
      const parts = partsFor(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
      await sendImageFor(sock, jid, parts);
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }
  }
}

// Post today's image to the group once per IST day. Tracked in a state file so
// it survives restarts (covers both the 00:01 cron and start-up catch-up), and
// so two cycles never double-post.
async function maybeDaily(sock) {
  if (!GROUP_JID || alreadyPostedToday()) return;
  try {
    const parts = istDateParts();
    const { buffer, via } = await getImage(parts);
    await sock.sendMessage(GROUP_JID, {
      image: buffer,
      caption: cleanCaption(`Daily Raasi Palan ${parts.label}`),
    });
    markPostedToday();
    persistSession();
    console.log(`[daily] posted ${parts.label} to group (via ${via}).`);
  } catch (e) {
    console.error(`[daily] FAILED: ${e.message}`);
  }
}

// ---- connection (self-healing) ------------------------------------------

let sock = null;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["wapstro-bot", "Chrome", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ Bot connected and listening.");
      maybeDaily(sock); // catch-up: post today's image if not already done
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error("Logged out by WhatsApp. Re-run `npm run link` and restart the bot.");
        process.exit(1);
      }
      console.warn(`Connection closed (code ${code}); reconnecting in 3s...`);
      setTimeout(() => start().catch((e) => console.error(e)), 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // "notify" = realtime; "append" = messages delivered on (re)connect that were
    // sent while we were briefly offline (the handoff window). Handle both, but
    // guard by recency so we never reply to old chat history on reconnect.
    if (type !== "notify" && type !== "append") return;
    for (const m of messages) {
      try {
        const id = m.key?.id;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);

        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid || "";
        if (!isPersonalChat(jid)) continue; // ignore groups/broadcast/status
        if (!isAllowed(jid)) continue;

        const ageSec = Date.now() / 1000 - Number(m.messageTimestamp || 0);
        const text = messageText(m);
        console.log(`[msg] type=${type} from=${senderNumber(jid)} age=${Math.round(ageSec)}s text=${JSON.stringify(text)}`);
        if (Number(m.messageTimestamp) && ageSec > 900) continue; // skip stale history

        const action = interpret(text);
        if (action.type === "ignore") continue;
        console.log(`[cmd] ${senderNumber(jid)} -> ${action.type}`);
        await handleCommand(sock, jid, action);
      } catch (e) {
        console.error(`message handling error: ${e.message}`);
      }
    }
  });
}

// ---- boot ----------------------------------------------------------------

console.log("Starting wapstro bot...");
console.log(
  `Group: ${GROUP_JID || "(none set)"} | allowlist: ${ALLOWED.length ? ALLOWED.join(",") : "ALL personal chats"} | run: ${RUN_MINUTES ? RUN_MINUTES + "m" : "forever"}`
);

if (!ensureSession()) {
  console.error("No session available (need auth/ folder or WA_CREDS/WA_ENC_KEY). Run `npm run link`.");
  process.exit(1);
}

await start();

// Daily post at 00:01 IST (maybeDaily de-dupes via the state file).
cron.schedule("1 0 * * *", () => sock && maybeDaily(sock), { timezone: TZ });
console.log("Daily post scheduled for 00:01 IST.");

// Persist the session periodically so a crash still leaves a recent snapshot
// for the workflow to commit.
if (WA_ENC_KEY) setInterval(persistSession, 10 * 60 * 1000).unref?.();

// Time-boxed mode (GitHub Actions cycle): run for RUN_MINUTES, then exit cleanly
// so the next cycle takes over with a freshly committed session.
if (RUN_MINUTES > 0) {
  setTimeout(() => {
    console.log(`Reached RUN_MINUTES=${RUN_MINUTES}; persisting session and exiting for handoff.`);
    persistSession();
    try { sock?.end(undefined); } catch {}
    process.exit(0);
  }, RUN_MINUTES * 60 * 1000);
}
