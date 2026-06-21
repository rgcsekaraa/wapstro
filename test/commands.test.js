import test from "node:test";
import assert from "node:assert/strict";
import { interpret, MAX_RANGE_DAYS } from "../src/commands.js";

test("/date returns a single-date action", () => {
  const action = interpret("/date 24-05-2026");

  assert.equal(action.type, "single");
  assert.equal(action.parts.label, "24-05-2026");
  assert.equal(action.parts.ddmmyyyy, "24052026");
});

test("date accepts slash and dot separators", () => {
  assert.equal(interpret("date 24/05/2026").parts.label, "24-05-2026");
  assert.equal(interpret("/date 24.05.2026").parts.label, "24-05-2026");
});

test("/date rejects invalid or missing dates with a helpful error", () => {
  assert.equal(interpret("/date").type, "error");
  assert.equal(interpret("/date 30-02-2026").type, "error");
});

test("bare slash date shortcut still works", () => {
  const action = interpret("/24-05-2026");

  assert.equal(action.type, "single");
  assert.equal(action.parts.label, "24-05-2026");
});

test("/range returns a bounded range action", () => {
  const action = interpret("/range 24-05-2026 29-05-2026");

  assert.equal(action.type, "range");
  assert.equal(action.start.label, "24-05-2026");
  assert.equal(action.end.label, "29-05-2026");
  assert.equal(action.days, 6);
});

test("/range normalizes reversed dates", () => {
  const action = interpret("/range 29-05-2026 24-05-2026");

  assert.equal(action.type, "range");
  assert.equal(action.start.label, "24-05-2026");
  assert.equal(action.end.label, "29-05-2026");
});

test("/range rejects overly large ranges", () => {
  const action = interpret("/range 01-05-2026 01-07-2026");

  assert.equal(action.type, "error");
  assert.match(action.message, new RegExp(`${MAX_RANGE_DAYS}`));
});
