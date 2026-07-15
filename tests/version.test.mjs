import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, releaseUrl } from "../lib/version.js";

test("compares dotted extension versions", () => {
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.1", "2.1"), -1);
});

test("builds a safe GitHub release URL", () => {
  assert.equal(
    releaseUrl("0.3.0"),
    "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.3.0"
  );
});
