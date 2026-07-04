const target = process.env.STRICT_SEND_UTC || "18:31";
const maxWaitMs = Number.parseInt(process.env.STRICT_SEND_MAX_WAIT_MS || `${4 * 60 * 60 * 1000}`, 10);

const match = /^(\d{2}):(\d{2})$/.exec(target);
if (!match) {
  console.error(`STRICT_SEND_UTC must be HH:MM, got "${target}".`);
  process.exit(1);
}

const now = new Date();
const targetDate = new Date(now);
targetDate.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);

const waitMs = targetDate.getTime() - now.getTime();
if (waitMs <= 0) {
  console.log(`Target ${target} UTC has already passed; sending immediately.`);
  process.exit(0);
}

if (waitMs > maxWaitMs) {
  console.log(`Target ${target} UTC is ${Math.round(waitMs / 60000)} minutes away; outside wait window.`);
  process.exit(0);
}

console.log(`Waiting ${Math.round(waitMs / 1000)} seconds until ${target} UTC.`);
await new Promise((resolve) => setTimeout(resolve, waitMs));
console.log(`Reached ${target} UTC; continuing.`);
