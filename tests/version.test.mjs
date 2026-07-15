import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("keeps release metadata aligned and avoids redundant host permissions", async () => {
  const [manifest, pkg, release] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../release.json", import.meta.url), "utf8").then(JSON.parse)
  ]);

  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.version, release.version);
  assert.equal(release.url, releaseUrl(manifest.version));
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal("optional_host_permissions" in manifest, false);
});

test("does not retain gateway subscription URLs in browser state", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const start = background.indexOf("function syncGatewayState");
  const end = background.indexOf("async function migrateSubscriptionsToGateway");
  assert.ok(start >= 0 && end > start);
  const syncGatewayState = background.slice(start, end);
  assert.match(syncGatewayState, /url:\s*""/);
  assert.doesNotMatch(syncGatewayState, /subscriptionUrls|old\?\.url/);
});

test("keeps gateway node cards synchronized automatically", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(background, /create\("sync-routeva-gateway",\s*\{\s*periodInMinutes:\s*60\s*\}\)/);
  assert.match(background, /alarm\.name === "sync-routeva-gateway"/);
});
