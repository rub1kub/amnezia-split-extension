import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLatency, isLatencyFresh, latencyLabel, latencyTone, sortByLatency } from "../lib/latency.js";

test("latency validates positive numeric values; Mihomo zero is not a success", () => {
  assert.equal(normalizeLatency(null), null);
  for (const delayMs of [undefined, null, "0", 0, 0.4, -1, NaN, Infinity, 60001]) {
    const result = normalizeLatency({ status: "ok", delayMs });
    assert.equal(result.status, "error");
    assert.equal(result.delayMs, null);
    assert.notEqual(latencyLabel(result), "0 мс");
  }
  assert.equal(normalizeLatency({ status: "ok", delayMs: 72.8 }).delayMs, 73);
});

test("unknown, timeout and unavailable measurements are never successful pings", () => {
  assert.equal(latencyLabel(null), "—");
  assert.equal(latencyLabel({ status: "timeout" }), "Тайм-аут");
  assert.equal(latencyLabel({ status: "unavailable" }), "Недоступен");
  assert.equal(latencyTone({ status: "timeout" }), "error");
  assert.equal(latencyTone({ status: "ok", delayMs: 95 }), "good");
  assert.equal(latencyTone({ status: "ok", delayMs: 260 }), "medium");
  assert.equal(latencyTone({ status: "ok", delayMs: 530 }), "slow");
  assert.equal(normalizeLatency({ status: "timeout", delayMs: 0, code: "secret url" }).code, null);
});

test("cached measurements expire after five minutes; future dates are not fresh", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  assert.equal(isLatencyFresh({ checkedAt: "2026-10-08T09:59:00Z" }, now), true);
  assert.equal(isLatencyFresh({ checkedAt: "2026-10-08T09:55:00Z" }, now), false);
  assert.equal(isLatencyFresh({ checkedAt: "2026-10-08T10:01:00Z" }, now), false);
  assert.equal(isLatencyFresh({}, now), false);
});

test("ping sort is stable and places untested/failed nodes after measured nodes", () => {
  const items = [
    { id: "unknown" },
    { id: "slow", latency: { status: "ok", delayMs: 400 } },
    { id: "failed", latency: { status: "timeout", delayMs: null } },
    { id: "fast", latency: { status: "ok", delayMs: 30 } },
    { id: "also-fast", latency: { status: "ok", delayMs: 30 } }
  ];
  assert.deepEqual(sortByLatency(items).map((item) => item.id), ["fast", "also-fast", "slow", "unknown", "failed"]);
  assert.equal(items[0].id, "unknown");
});
