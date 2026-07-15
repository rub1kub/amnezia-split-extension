import test from "node:test";
import assert from "node:assert/strict";
import { countryFlag, pacProxyDirective } from "../lib/proxy.js";
import { parseProxyUri, parseSubscription, subscriptionNodeToServer } from "../lib/subscriptions.js";

test("creates PAC directives for supported proxy schemes", () => {
  assert.equal(pacProxyDirective({ scheme: "http", host: "proxy.example", port: 8080 }), "PROXY proxy.example:8080");
  assert.equal(pacProxyDirective({ scheme: "socks5", host: "127.0.0.1", port: 1080 }), "SOCKS5 127.0.0.1:1080");
});

test("builds a flag from ISO country code", () => {
  assert.equal(countryFlag("de"), "🇩🇪");
  assert.equal(countryFlag(""), "🌐");
});

test("parses a compatible proxy URI without leaking unsupported credentials", () => {
  const node = parseProxyUri("socks5://user:pass@127.0.0.1:1080#Happ%20Local");
  assert.equal(node.protocol, "socks5");
  assert.equal(node.name, "Happ Local");
  assert.equal(node.compatible, true);
  assert.equal(node.username, "user");
  assert.equal(subscriptionNodeToServer(node, "sub-1", "server-1").scheme, "socks5");
});

test("recognizes companion-only protocols", () => {
  const result = parseSubscription([
    "vless://uuid@example.com:443#Germany",
    "trojan://secret@example.net:443#Netherlands",
    "https://user:pass@proxy.example.org:8443#Direct"
  ].join("\n"));
  assert.equal(result.nodes.length, 3);
  assert.equal(result.compatibleCount, 1);
  assert.equal(result.companionCount, 2);
  assert.deepEqual(result.protocols, ["https", "trojan", "vless"]);
  assert.equal(result.nodes.find((node) => node.protocol === "vless").password, "");
});

test("parses base64 encoded URI subscriptions", () => {
  const encoded = Buffer.from("http://proxy.example:3128#One\nsocks4://127.0.0.1:1080#Two").toString("base64");
  const result = parseSubscription(encoded);
  assert.equal(result.compatibleCount, 2);
});

test("parses simple Clash YAML proxy blocks", () => {
  const result = parseSubscription(`
proxies:
  - name: Local SOCKS
    type: socks5
    server: 127.0.0.1
    port: 1080
  - name: Remote VLESS
    type: vless
    server: edge.example
    port: 443
`);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.compatibleCount, 1);
  assert.equal(result.companionCount, 1);
});

test("recognizes base64 Shadowsocks links", () => {
  const authority = Buffer.from("aes-256-gcm:secret@example.net:8388").toString("base64url");
  const result = parseSubscription(`ss://${authority}#Stockholm`);
  assert.equal(result.nodes[0].protocol, "ss");
  assert.equal(result.nodes[0].name, "Stockholm");
  assert.equal(result.nodes[0].host, "example.net");
  assert.equal(result.nodes[0].port, 8388);
  assert.equal(result.nodes[0].requiresCompanion, true);
});

test("parses compact Clash YAML proxy objects", () => {
  const result = parseSubscription(`proxies:\n  - {name: Local SOCKS, type: socks5, server: 127.0.0.1, port: 1080}\n  - {name: Paris, type: trojan, server: fr.example, port: 443}`);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.compatibleCount, 1);
  assert.equal(result.companionCount, 1);
});
