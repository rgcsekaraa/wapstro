import test from "node:test";
import assert from "node:assert/strict";
import { postDailyImages } from "../src/postDaily.js";
import { partsFor } from "../src/download.js";

const silentLogger = { log: () => {}, warn: () => {} };

test("sends the primary image even when Srirangam is unavailable", async () => {
  const messages = [];
  const primary = { buffer: Buffer.from("primary"), via: "cache" };
  const result = await postDailyImages({
    sock: { sendMessage: async (jid, message) => messages.push({ jid, message }) },
    jid: "group@g.us",
    targetLabel: "production",
    parts: partsFor(3, 8, 2026),
    primary,
    loadSrirangam: async () => {
      throw new Error("image HTTP 415");
    },
    logger: silentLogger,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].jid, "group@g.us");
  assert.equal(messages[0].message.image, primary.buffer);
  assert.equal(result.primarySent, true);
  assert.equal(result.srirangamSent, false);
});

test("sends Srirangam after the primary when both are available", async () => {
  const messages = [];
  const primary = { buffer: Buffer.from("primary"), via: "cache" };
  const srirangam = {
    buffer: Buffer.from("srirangam"),
    url: "https://srirangaminfo.com/cal/2026/0308.jpg",
    via: "srirangam-scrape",
  };
  const result = await postDailyImages({
    sock: { sendMessage: async (_jid, message) => messages.push(message) },
    jid: "group@g.us",
    targetLabel: "production",
    parts: partsFor(3, 8, 2026),
    primary,
    loadSrirangam: async () => srirangam,
    logger: silentLogger,
  });

  assert.deepEqual(
    messages.map((message) => message.image),
    [primary.buffer, srirangam.buffer]
  );
  assert.equal(result.srirangamSent, true);
  assert.equal(result.srirangam, srirangam);
});
