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

test("does not re-probe a known exit on every popup open", async () => {
  const popup = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  assert.match(popup, /next\.configured && !next\.activeServer\?\.exitIp/);
  assert.match(popup, /render\(next\);[\s\S]*probeLocationInBackground\(next\.activeServerId\)/);
  assert.doesNotMatch(popup, /showNotice\(`Выбран:/);
});

test("keeps the popup server card stable and searchable", async () => {
  const [popup, css] = await Promise.all([
    readFile(new URL("../src/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.css", import.meta.url), "utf8")
  ]);
  assert.match(popup, /function renderServerSearch\(\)/);
  assert.doesNotMatch(popup, /country-flag/);
  assert.doesNotMatch(css, /server-card-in/);
});

test("keeps gateway nodes compact and switches without a full resync", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const normalizeStart = background.indexOf("function normalizeServer");
  const normalizeEnd = background.indexOf("function normalizeSubscription");
  const selectStart = background.indexOf("async function selectServer");
  const selectEnd = background.indexOf("async function deleteServer");
  const normalizeServer = background.slice(normalizeStart, normalizeEnd);
  const selectServer = background.slice(selectStart, selectEnd);

  assert.match(normalizeServer, /gatewayNode \? "" : String\(server\.password/);
  assert.match(selectServer, /gatewayRequest\(state, "\/v1\/nodes\/select"/);
  assert.doesNotMatch(selectServer, /syncGatewayState/);
  assert.doesNotMatch(selectServer, /setTimeout|probeActiveServerLocation/);
});

test("preserves the last gateway snapshot on a transient empty sync", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const start = background.indexOf("function syncGatewayState");
  const end = background.indexOf("async function migrateSubscriptionsToGateway");
  const syncGatewayState = background.slice(start, end);
  assert.match(syncGatewayState, /preserveLastSnapshot/);
  assert.match(syncGatewayState, /oldGatewayServers\.map/);
});
