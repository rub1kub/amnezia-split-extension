import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as rules from "../lib/rules.js";
import * as proxy from "../lib/proxy.js";
import * as version from "../lib/version.js";
import * as latency from "../lib/latency.js";

const code = (await readFile(new URL("../src/background.js", import.meta.url), "utf8"))
  .replace(/import\s+[\s\S]*?from\s+"[^"\n]+";/g, "")
  .split("chrome.runtime.onMessage.addListener")[0];
const fixture = () => ({
  gateway: { enabled: true, apiUrl: "https://gateway.example:18445", proxyServerId: "manual" },
  servers: [
    { id: "manual", source: "manual", name: "Gateway", host: "gateway.example", scheme: "https", port: 18443, username: "test", password: "test-only" },
    { id: "node", source: "gateway", name: "Berlin", gatewayNodeId: "a".repeat(24), sourceNodeKey: "[routeva_test] Berlin", subscriptionId: "test" }
  ],
  activeServerId: "manual", enabled: true, configured: true,
  subscriptions: [{ id: "test", name: "Example" }]
});

function harness(fetchImpl, saved = {}, allowProxy = false) {
  const store = { state: fixture(), ...structuredClone(saved) };
  const writes = [];
  const chrome = {
    storage: { local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (value) => { writes.push(value); Object.assign(store, structuredClone(value)); }
    } },
    proxy: { settings: {
      set: () => { if (!allowProxy) throw new Error("Ping must not set browser proxy"); },
      clear: () => { throw new Error("Ping must not clear browser proxy"); }
    } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} }
  };
  const context = vm.createContext({ ...rules, ...proxy, ...version, ...latency, chrome, fetch: fetchImpl, URL, AbortSignal, Date, console, btoa, TextEncoder });
  vm.runInContext(code, context);
  return { store, writes, run: (expression) => vm.runInContext(expression, context) };
}

const goodResponse = () => ({ ok: true, json: async () => ({ id: "a".repeat(24), method: "gateway-proxy", status: "ok", delayMs: 51, checkedAt: "2026-10-08T10:00:00Z" }) });

test("ping invokes only the authenticated ping API and leaves selected server/PAC unchanged", async () => {
  const calls = [];
  const h = harness(async (url, options) => { calls.push({ url, options }); return goodResponse(); });
  const result = await h.run('handleMessage({ type: "pingServer", id: "node" })');
  assert.equal(result.latency.delayMs, 51);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example:18445/v1/nodes/ping");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { id: "a".repeat(24) });
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(h.store.state.activeServerId, "manual");
  assert.deepEqual(h.writes.map((value) => Object.keys(value)), [["serverLatencies"]]);
  const cached = await h.run('handleMessage({ type: "getServerLatencies" })');
  assert.equal(cached.node.delayMs, 51);
});

test("concurrent checks of the same node share one in-flight request", async () => {
  let count = 0;
  let unblock;
  const hold = new Promise((resolve) => { unblock = resolve; });
  const h = harness(async () => { count++; await hold; return goodResponse(); });
  const requests = h.run('Promise.all([pingServer("node"), pingServer("node")])');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(count, 1);
  unblock();
  const result = await requests;
  assert.equal(result.length, 2);
  assert.equal(h.writes.length, 1);
});

test("manual proxies are not switched or measured with misleading direct fetches", async () => {
  const h = harness(() => { throw new Error("Unexpected network call"); });
  assert.equal((await h.run('pingServer("manual")')).latency.status, "unsupported");
  await assert.rejects(h.run('pingServer("missing")'), /Сервер не найден/);
  assert.equal(h.writes.length, 0);
});

test("a legacy Gateway gives an actionable update error without cached fake success", async () => {
  const h = harness(async () => ({ ok: false, status: 404, json: async () => ({ error: "Not found" }) }));
  await assert.rejects(h.run('pingServer("node")'), /0\.9\.1/);
  assert.equal(h.writes.length, 0);
});

test("rejects mismatched IDs and suppresses cached results after configuration change", async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ ...await goodResponse().json(), id: "b".repeat(24) }) }));
  await assert.rejects(h.run('pingServer("node")'), /некорректный/);
  assert.equal(h.writes.length, 0);
  const g = harness(async () => goodResponse());
  await g.run('pingServer("node")');
  g.run('stateCache.gateway.apiUrl = "https://other.example:18445"');
  assert.equal(Object.keys(await g.run('handleMessage({ type: "getServerLatencies" })')).length, 0);
});

test("connects an existing Gateway using only GET status, without importing or selecting remotely", async () => {
  const calls = [];
  const state = fixture();
  state.gateway = null;
  state.servers = state.servers.filter((server) => server.source === "manual");
  state.subscriptions = [];
  const selected = "[routeva_test] Berlin";
  const h = harness(async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, json: async () => ({
      selected,
      nodes: [{ id: "a".repeat(24), key: selected, name: "Berlin", protocol: "vless", subscriptionId: "test" }],
      subscriptions: [{ id: "test", name: "Existing", nodeCount: 1, protocols: ["vless"] }]
    }) };
  }, { state }, true);
  const result = await h.run('handleMessage({ type: "connectGateway" })');
  assert.deepEqual(calls, [{ url: "https://gateway.example:18445/v1/status", method: "GET" }]);
  assert.equal(result.gateway.connected, true);
  assert.equal(result.servers.length, 2);
  assert.equal(result.activeServer.sourceNodeKey, selected);
  assert.equal(h.store.state.subscriptions[0].url, "");
});
