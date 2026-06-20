// Encrypted session persistence WITHOUT a PAT.
//
// The daily GitHub Actions job commits the refreshed WhatsApp session back into
// the repo as an encrypted file (state/session.enc), using the workflow's
// built-in GITHUB_TOKEN. The encryption key lives only in the WA_ENC_KEY secret,
// so even if the repo leaked, the session stays protected.
//
// This (a) keeps the session fresh forever with no PAT, and (b) the daily commit
// doubles as repo activity so scheduled workflows are never auto-disabled.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = "state";
const SESSION_FILE = path.join(STATE_DIR, "session.enc");

// AES-256-GCM. Layout (base64): [12-byte IV][16-byte tag][ciphertext].
export function encryptSession(base64Creds, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("WA_ENC_KEY must be 64 hex chars (32 bytes).");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(base64Creds, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, Buffer.concat([iv, tag, enc]).toString("base64"));
}

// Returns the decrypted base64 creds string, or null if no file / no key.
export function decryptSession(keyHex) {
  if (!keyHex || !fs.existsSync(SESSION_FILE)) return null;
  const key = Buffer.from(keyHex, "hex");
  const raw = Buffer.from(fs.readFileSync(SESSION_FILE, "utf8"), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export { SESSION_FILE, STATE_DIR };
