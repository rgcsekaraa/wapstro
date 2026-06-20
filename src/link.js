// ONE-TIME local setup. Run on your own machine:  npm run link
//
// Shows a QR code. On your phone: WhatsApp > Settings > Linked devices >
// Link a device > scan it. Once linked, this prints the base64 value to store
// in the GitHub repo secret WA_CREDS.

import { connect } from "./connect.js";
import { dumpAuthDir, AUTH_DIR } from "./lib.js";

async function main() {
  console.log("Starting WhatsApp link flow. Waiting for QR...");
  const { sock } = await connect({ printQR: true });
  console.log("\n✅ Linked successfully!\n");

  // Wait a few seconds for the initial creds/keys to settle on disk.
  await new Promise((r) => setTimeout(r, 5000));

  const base64 = dumpAuthDir(AUTH_DIR);
  console.log("=".repeat(70));
  console.log("Copy EVERYTHING between the lines below into the WA_CREDS secret:");
  console.log("=".repeat(70));
  console.log(base64);
  console.log("=".repeat(70));
  console.log(`(length: ${base64.length} chars)`);
  console.log("\nNext: run `npm run groups` to find your group's JID.");

  sock.end(undefined);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
