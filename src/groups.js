// ONE-TIME helper. Run locally after linking:  npm run groups
//
// Lists every group your linked number is in, with its JID (group id ending in
// @g.us). Copy the JID of your target group into the GROUP_JID secret.
//
// Uses the local ./auth folder created by `npm run link`. If you only have the
// WA_CREDS value, set it as an env var first:  WA_CREDS=... npm run groups

import { connect } from "./connect.js";
import { restoreAuthDir, AUTH_DIR } from "./lib.js";
import fs from "node:fs";

async function main() {
  if (process.env.WA_CREDS && !fs.existsSync(`${AUTH_DIR}/creds.json`)) {
    restoreAuthDir(process.env.WA_CREDS, AUTH_DIR);
  }

  console.log("Connecting...");
  const { sock } = await connect({ printQR: false });

  const groups = await sock.groupFetchAllParticipating();
  const list = Object.values(groups);

  if (list.length === 0) {
    console.log("No groups found for this number.");
  } else {
    console.log(`\nFound ${list.length} group(s):\n`);
    for (const g of list) {
      const admins = g.participants.filter((p) => p.admin).map((p) => p.id);
      console.log(`• ${g.subject}`);
      console.log(`    JID: ${g.id}`);
      console.log(`    announce-only (admins only): ${g.announce ? "yes" : "no"}`);
      console.log(`    admins: ${admins.length}\n`);
    }
    console.log("Copy the JID of your target group into the GROUP_JID secret.");
  }

  sock.end(undefined);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
