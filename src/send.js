// Daily job: restore the WhatsApp session, download today's Tamil calendar
// image, post it to the configured group, then persist any refreshed session
// state back into the WA_CREDS secret.

import { istDateParts } from "./download.js";
import { getImage, cleanCaption } from "./image.js";
import { connect } from "./connect.js";
import { AUTH_DIR, restoreAuthDir, dumpAuthDir, updateRepoSecret } from "./lib.js";

const {
  WA_CREDS,
  GROUP_JID,
  GH_PAT,
  GITHUB_REPOSITORY,
  IMAGE_CAPTION = "",
} = process.env;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!WA_CREDS) fail("WA_CREDS secret is empty. Run `npm run link` locally first.");
  if (!GROUP_JID) fail("GROUP_JID is not set. Run `npm run groups` to find it.");
  if (!GROUP_JID.endsWith("@g.us")) {
    fail(`GROUP_JID "${GROUP_JID}" doesn't look like a group id (should end in @g.us).`);
  }

  restoreAuthDir(WA_CREDS, AUTH_DIR);

  console.log("Resolving today's calendar image...");
  const { buffer, url, parts, via } = await getImage(istDateParts());
  console.log(`Got ${buffer.length} bytes from ${url} (via ${via})`);

  console.log("Connecting to WhatsApp...");
  const { sock } = await connect({ printQR: false });
  console.log("Connected.");

  const caption = cleanCaption(
    IMAGE_CAPTION.trim()
      ? IMAGE_CAPTION.replace("{date}", parts.label)
      : `Daily Raasi Palan ${parts.label}`
  );

  await sock.sendMessage(GROUP_JID, { image: buffer, caption });
  console.log(`Sent image to ${GROUP_JID}`);

  // Give Baileys a moment to flush any session/key updates to disk.
  await new Promise((r) => setTimeout(r, 4000));

  // Persist refreshed session back to the secret only if it actually changed.
  const updated = dumpAuthDir(AUTH_DIR);
  if (updated !== WA_CREDS) {
    if (GH_PAT) {
      console.log("Session changed; updating WA_CREDS secret...");
      try {
        await updateRepoSecret({
          repo: GITHUB_REPOSITORY,
          token: GH_PAT,
          name: "WA_CREDS",
          value: updated,
        });
        console.log("WA_CREDS secret updated.");
      } catch (e) {
        // Don't fail the whole job just because the refresh failed — the image
        // was already delivered. Surface it so the user can fix the PAT.
        console.error(`WARN: could not update WA_CREDS secret: ${e.message}`);
      }
    } else {
      console.warn(
        "WARN: session changed but GH_PAT not set — skipping secret refresh. " +
          "Set GH_PAT so the session stays fresh long-term."
      );
    }
  } else {
    console.log("Session unchanged; no secret update needed.");
  }

  // Close the socket WITHOUT logging out (logout would unlink the device).
  sock.end(undefined);
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
