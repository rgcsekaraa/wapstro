// Shared helpers: serialize/restore the Baileys auth folder to a single base64
// blob, and push an updated value into a GitHub Actions secret.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// libsodium-wrappers ships a broken ESM entry under Node, so load its working
// CommonJS build instead.
const require = createRequire(import.meta.url);
const _sodium = require("libsodium-wrappers");

export const AUTH_DIR = "auth";

// Write every file in the auth dir into a JSON map -> base64. This is what we
// store in the WA_CREDS secret so the linked-device session survives between
// stateless GitHub Actions runs.
export function dumpAuthDir(dir = AUTH_DIR) {
  const map = {};
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile()) {
      map[name] = fs.readFileSync(full, "utf8");
    }
  }
  return Buffer.from(JSON.stringify(map), "utf8").toString("base64");
}

// Recreate the auth dir on disk from a base64 blob (the WA_CREDS secret).
export function restoreAuthDir(base64, dir = AUTH_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  if (!base64) return false;
  const map = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  for (const [name, content] of Object.entries(map)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return true;
}

// Encrypt `value` for the repo's public key and PUT it as a secret.
// Requires a PAT with "Secrets: Read and write" on the repo.
export async function updateRepoSecret({ repo, token, name, value }) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set.");
  if (!token) throw new Error("GH_PAT is not set (needs Secrets write access).");

  const api = `https://api.github.com/repos/${repo}/actions/secrets`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const keyRes = await fetch(`${api}/public-key`, { headers });
  if (!keyRes.ok) {
    throw new Error(`Fetching public key failed: HTTP ${keyRes.status} ${await keyRes.text()}`);
  }
  const { key, key_id } = await keyRes.json();

  await _sodium.ready;
  const sodium = _sodium;
  const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const binVal = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binVal, binKey);
  const encrypted_value = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  const putRes = await fetch(`${api}/${name}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ encrypted_value, key_id }),
  });
  if (!putRes.ok) {
    throw new Error(`Updating secret ${name} failed: HTTP ${putRes.status} ${await putRes.text()}`);
  }
}
