// Builds a connected Baileys socket from the on-disk auth folder and resolves
// once the connection is open. Handles the common "restart required" (515)
// handshake by reconnecting a few times. Used by send.js and groups.js.

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import { AUTH_DIR } from "./lib.js";

const logger = pino({ level: "fatal" });
export const QR_PNG = "qr.png";

export async function connect({ printQR = false, maxRetries = 4 } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  let attempt = 0;

  function attemptConnection() {
    return new Promise((resolve, reject) => {
      const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false, // we render the QR ourselves (below)
        browser: ["wapstro", "Chrome", "1.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && printQR) {
          console.log("\nScan this QR with WhatsApp > Linked devices > Link a device:\n");
          qrcodeTerminal.generate(qr, { small: true });
          QRCode.toFile(QR_PNG, qr, { width: 500, margin: 2 })
            .then(() => console.log(`(also saved as ${QR_PNG})`))
            .catch(() => {});
        }
        if (connection === "open") {
          resolve(sock);
          return;
        }
        if (connection === "close") {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            reject(new Error("Session logged out. Re-run `npm run link` and update the WA_CREDS secret."));
            return;
          }
          // restartRequired (515) and other transient drops: retry.
          if (attempt < maxRetries) {
            attempt += 1;
            console.error(`Connection closed (code ${code}); retry ${attempt}/${maxRetries}...`);
            attemptConnection().then(resolve, reject);
          } else {
            reject(new Error(`Connection closed after ${maxRetries} retries (code ${code}).`));
          }
        }
      });
    });
  }

  const sock = await attemptConnection();
  return { sock, saveCreds };
}
