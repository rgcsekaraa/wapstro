// Pure command-parsing logic (no WhatsApp / no side effects), so it can be unit
// tested. bot.js wires these to the live socket.

import { partsFor } from "./download.js";
import { cleanCaption } from "./image.js";

export const MAX_RANGE_DAYS = 31;

export const HELP = cleanCaption(
  [
    "Raasi Palan bot. Send me:",
    "",
    "/date 24-05-2026",
    "   the calendar image for that date",
    "",
    "/24-05-2026",
    "   shortcut for /date",
    "",
    "/range 24-05-2026 29-05-2026",
    "   an image for each day in the range",
    "",
    "Dates are DD-MM-YYYY.",
  ].join("\n")
);

// Parse "DD-MM-YYYY" into validated parts, or null if it isn't a real date.
export function parseDate(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const day = +m[1], month = +m[2], year = +m[3];
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null; // e.g. 32-01-2026, 30-02-2026
  }
  if (year < 2005 || year > 2099) return null; // site only has 2005+ ; sane upper bound
  return partsFor(day, month, year);
}

export function partsToUTC(p) {
  return Date.UTC(+p.year, +p.mm - 1, +p.dd);
}

// Classify an incoming text into an action object:
//   {type:'ignore'} | {type:'help'} | {type:'error', message}
//   {type:'single', parts} | {type:'range', start, end, days}
export function interpret(textRaw) {
  const text = String(textRaw || "").trim();
  if (!text) return { type: "ignore" };

  const lower = text.toLowerCase();
  if (lower === "/help" || lower === "help" || lower === "/start") return { type: "help" };

  // /date A  (slash optional; accept - / . separators)
  const dateMatch = /^\/?date\s+(\S+)\s*$/i.exec(text);
  if (dateMatch) {
    const value = normalizeSep(dateMatch[1]);
    const parts = parseDate(value);
    if (!parts) {
      return {
        type: "error",
        message: `"${dateMatch[1]}" is not a valid date. Use: /date DD-MM-YYYY\nExample: /date 24-05-2026`,
      };
    }
    return { type: "single", parts };
  }

  // bare "/date" / "date" without a valid date
  if (/^\/?date\b/i.test(text)) {
    return {
      type: "error",
      message: "Date needs one date. Use: /date DD-MM-YYYY\nExample: /date 24-05-2026",
    };
  }

  // /range A B  (slash optional, extra whitespace tolerated)
  const rangeMatch = /^\/?range\s+(\S+)\s+(\S+)\s*$/i.exec(text);
  if (rangeMatch) {
    const a = parseDate(normalizeSep(rangeMatch[1]));
    const b = parseDate(normalizeSep(rangeMatch[2]));
    if (!a || !b) {
      return {
        type: "error",
        message:
          "I couldn't read those dates. Use: /range DD-MM-YYYY DD-MM-YYYY\nExample: /range 24-05-2026 29-05-2026",
      };
    }
    let start = a, end = b;
    if (partsToUTC(start) > partsToUTC(end)) [start, end] = [end, start]; // forgiving
    const days = Math.round((partsToUTC(end) - partsToUTC(start)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) {
      return { type: "error", message: `That range is ${days} days. Please keep it to ${MAX_RANGE_DAYS} days or fewer.` };
    }
    return { type: "range", start, end, days };
  }

  // bare "/range" / "range" without two valid dates
  if (/^\/?range\b/i.test(text)) {
    return {
      type: "error",
      message:
        "Range needs two dates. Use: /range DD-MM-YYYY DD-MM-YYYY\nExample: /range 24-05-2026 29-05-2026",
    };
  }

  // single date (slash optional; accept - / . separators)
  const single = text.replace(/^\//, "");
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(single)) {
    const parts = parseDate(normalizeSep(single));
    if (!parts) {
      return { type: "error", message: `"${single}" is not a valid date. Use DD-MM-YYYY, e.g. 24-05-2026.` };
    }
    return { type: "single", parts };
  }

  // looked like a command but unrecognized
  if (text.startsWith("/")) return { type: "error", message: `I didn't understand that.\n\n${HELP}` };

  // ordinary chat -> stay quiet
  return { type: "ignore" };
}

function normalizeSep(s) {
  return String(s).replace(/[/.]/g, "-");
}
