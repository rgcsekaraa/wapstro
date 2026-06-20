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
// Run:  npm run bot   (must stay running 24/7 to answer messages)

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import cron from "node-cron";
import { partsFor, istDateParts } from "./download.js";
import { getImage, cleanCaption } from "./image.js";
import { AUTH_DIR } from "./lib.js";
import { interpret, partsToUTC, HELP } from "./commands.js";

const logger = pino({ level: "fatal" });
const TZ = "Asia/Kolkata";
const SEND_GAP_MS = 1500; // polite gap between range images

const GROUP_JID = process.env.GROUP_JID || "";
// Optional allowlist of phone numbers (digits only, comma-separated). Empty = any
// personal chat may use the commands.
const ALLOWED = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.replace(/\D/g, ""))
  .filter(Boolean);

// ---- helpers -------------------------------------------------------------

function senderNumber(jid) {
  return (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isAllowed(jid) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(senderNumber(jid));
}

function messageText(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    ""
  ).trim();
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

async function postDaily(sock) {
  if (!GROUP_JID) {
    console.warn("Daily post skipped: GROUP_JID not set.");
    return;
  }
  try {
    const parts = istDateParts();
    const { buffer, via } = await getImage(parts);
    await sock.sendMessage(GROUP_JID, {
      image: buffer,
      caption: cleanCaption(`Daily Raasi Palan ${parts.label}`),
    });
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
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid || "";
        if (!jid.endsWith("@s.whatsapp.net")) continue; // personal chats only
        if (!isAllowed(jid)) continue;

        const action = interpret(messageText(m));
        if (action.type === "ignore") continue;
        console.log(`[cmd] ${senderNumber(jid)}: "${messageText(m)}" -> ${action.type}`);
        await handleCommand(sock, jid, action);
      } catch (e) {
        console.error(`message handling error: ${e.message}`);
      }
    }
  });
}

// ---- boot ----------------------------------------------------------------

console.log("Starting wapstro bot...");
console.log(`Group: ${GROUP_JID || "(none set)"} | allowlist: ${ALLOWED.length ? ALLOWED.join(",") : "ALL personal chats"}`);

await start();

// Daily post at 00:01 IST.
cron.schedule("1 0 * * *", () => sock && postDaily(sock), { timezone: TZ });
console.log("Daily post scheduled for 00:01 IST.");
