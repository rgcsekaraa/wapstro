import { istDateParts, partsFor, partsFromIsoDate } from "./download.js";
import { probeSrirangamForParts } from "./srirangam.js";

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const values = { days: 3000, concurrency: 3, delayMs: 50, start: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--days") values.days = parsePositiveInt(value, "days");
    else if (flag === "--concurrency") values.concurrency = parsePositiveInt(value, "concurrency");
    else if (flag === "--delay-ms") values.delayMs = parsePositiveInt(value, "delay-ms");
    else if (flag === "--start") values.start = partsFromIsoDate(value);
    else throw new Error(`unknown argument "${flag}"`);
    index += 1;
  }
  return values;
}

function partsAtOffset(start, offset) {
  const date = new Date(Date.UTC(Number(start.year), Number(start.mm) - 1, Number(start.dd)));
  date.setUTCDate(date.getUTCDate() + offset);
  return partsFor(date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear());
}

function summarizeRanges(results) {
  const ranges = [];
  for (const result of results) {
    const status = result.available ? "available" : result.error ? "error" : "missing";
    const current = ranges.at(-1);
    if (current?.status === status) {
      current.end = result.parts.label;
      current.days += 1;
    } else {
      ranges.push({ status, start: result.parts.label, end: result.parts.label, days: 1 });
    }
  }
  return ranges;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const start = options.start || istDateParts();
  const results = new Array(options.days);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= options.days) return;
      const parts = partsAtOffset(start, index);
      try {
        const result = await probeSrirangamForParts(parts);
        results[index] = { ...result, parts };
      } catch (error) {
        results[index] = { available: false, error: error.message, parts };
      }
      completed += 1;
      if (completed % 250 === 0 || completed === options.days) {
        console.log(`Checked ${completed}/${options.days} dates...`);
      }
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.days) }, worker));

  const available = results.filter((result) => result.available).length;
  const errors = results.filter((result) => result.error).length;
  const missing = options.days - available - errors;
  console.log(
    `Srirangam audit ${start.label} through ${results.at(-1).parts.label}: ` +
      `${available} available, ${missing} missing, ${errors} request errors.`
  );
  for (const range of summarizeRanges(results)) {
    console.log(`${range.status}: ${range.start} through ${range.end} (${range.days} days)`);
  }

  if (missing > 0 || errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
