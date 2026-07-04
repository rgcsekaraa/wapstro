// Daily job: restore the WhatsApp session, post today's Tamil calendar image to
// the configured group, then persist any refreshed session so it never expires.
//
// Session source priority: encrypted state/session.enc (committed back each run,
// no PAT needed) -> WA_CREDS secret (bootstrap). After posting, the refreshed
// session is re-encrypted to state/session.enc for the workflow to commit.

import fs from "node:fs";
import { istDateParts } from "./download.js";
import { getImage, cleanCaption } from "./image.js";
import { downloadSrirangamForParts } from "./srirangam.js";
import { connect } from "./connect.js";
import { AUTH_DIR, restoreAuthDir, dumpAuthDir, updateRepoSecret } from "./lib.js";
import { encryptSession, decryptSession, STATE_DIR } from "./session.js";

const {
  WA_CREDS,
  WA_ENC_KEY,
  GROUP_JID,
  TEST_GROUP_JID,
  SEND_TARGET_GROUP = "production",
  GH_PAT,
  GITHUB_REPOSITORY,
  IMAGE_CAPTION = "",
  SRIRANGAM_IMAGE_CAPTION = "",
} = process.env;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function targetGroupJid() {
  const target = SEND_TARGET_GROUP.toLowerCase();
  if (target === "test") {
    if (!TEST_GROUP_JID) fail("SEND_TARGET_GROUP=test but TEST_GROUP_JID is not set.");
    return { jid: TEST_GROUP_JID, label: "test" };
  }
  if (target !== "production") {
    fail(`SEND_TARGET_GROUP must be "production" or "test", got "${SEND_TARGET_GROUP}".`);
  }
  if (!GROUP_JID) fail("GROUP_JID is not set. Run `npm run groups` to find it.");
  return { jid: GROUP_JID, label: "production" };
}

function assertGroupJid(jid, name) {
  if (!jid.endsWith("@g.us")) {
    fail(`${name} "${jid}" doesn't look like a group id (should end in @g.us).`);
  }
}

async function main() {
  const target = targetGroupJid();
  assertGroupJid(target.jid, `${target.label} group`);
  console.log(`Using ${target.label} WhatsApp group.`);

  // Load session: prefer the committed encrypted file, fall back to the secret.
  let creds = null;
  try {
    creds = decryptSession(WA_ENC_KEY);
    if (creds) console.log("Loaded session from state/session.enc");
  } catch (e) {
    console.warn(`Could not decrypt state/session.enc (${e.message}); using WA_CREDS secret.`);
  }
  if (!creds) {
    if (!WA_CREDS) fail("No session: state/session.enc missing/undecryptable and WA_CREDS empty.");
    creds = WA_CREDS;
    console.log("Loaded session from WA_CREDS secret (bootstrap).");
  }
  restoreAuthDir(creds, AUTH_DIR);

  const parts = istDateParts();

  console.log("Resolving today's Tamil Daily Calendar image...");
  const primary = await getImage(parts);
  console.log(`Got ${primary.buffer.length} bytes from ${primary.url} (via ${primary.via})`);

  console.log("Resolving today's Srirangam Tamil calendar image...");
  const srirangam = await downloadSrirangamForParts(parts);
  console.log(`Got ${srirangam.buffer.length} bytes from ${srirangam.url} (via ${srirangam.via})`);

  console.log("Connecting to WhatsApp...");
  const { sock } = await connect({ printQR: false });
  console.log("Connected.");

  const caption = cleanCaption(
    IMAGE_CAPTION.trim()
      ? IMAGE_CAPTION.replace("{date}", parts.label)
      : `Daily Raasi Palan ${parts.label}`
  );

  await sock.sendMessage(target.jid, { image: primary.buffer, caption });
  console.log(`Sent Tamil Daily Calendar image to ${target.label} group.`);

  const srirangamCaption = cleanCaption(
    SRIRANGAM_IMAGE_CAPTION.trim()
      ? SRIRANGAM_IMAGE_CAPTION.replace("{date}", parts.label)
      : `Srirangam Tamil Calendar ${parts.label}`
  );

  await sock.sendMessage(target.jid, { image: srirangam.buffer, caption: srirangamCaption });
  console.log(`Sent Srirangam Tamil calendar image to ${target.label} group.`);

  // Give Baileys a moment to flush any session/key updates to disk.
  await new Promise((r) => setTimeout(r, 4000));

  const updated = dumpAuthDir(AUTH_DIR);

  // Primary persistence: encrypted file committed back by the workflow (no PAT).
  if (WA_ENC_KEY) {
    try {
      encryptSession(updated, WA_ENC_KEY);
      console.log("Wrote refreshed session to state/session.enc");
    } catch (e) {
      console.error(`WARN: could not write encrypted session: ${e.message}`);
    }
  } else {
    console.warn("WARN: WA_ENC_KEY not set — session will not be persisted (it may expire over time).");
  }

  // Optional extra: also update the WA_CREDS secret if a PAT is configured.
  if (GH_PAT && updated !== WA_CREDS) {
    try {
      await updateRepoSecret({ repo: GITHUB_REPOSITORY, token: GH_PAT, name: "WA_CREDS", value: updated });
      console.log("WA_CREDS secret also updated.");
    } catch (e) {
      console.error(`WARN: could not update WA_CREDS secret: ${e.message}`);
    }
  }

  // Heartbeat so the repo always has same-day activity (keeps cron from being
  // auto-disabled after 60 idle days). Committed by the workflow.
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(`${STATE_DIR}/last-run.txt`, `${new Date().toISOString()} posted ${parts.label}\n`);
  } catch {}

  // Close the socket WITHOUT logging out (logout would unlink the device).
  sock.end(undefined);
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
