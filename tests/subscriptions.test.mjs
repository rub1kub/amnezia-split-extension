import test from "node:test";
import assert from "node:assert/strict";
import { countryFlag, inferCountryCodeFromName, pacProxyDirective } from "../lib/proxy.js";

test("creates PAC directives for supported proxy schemes", () => {
  assert.equal(pacProxyDirective({ scheme: "http", host: "proxy.example", port: 8080 }), "PROXY proxy.example:8080");
  assert.equal(pacProxyDirective({ scheme: "socks5", host: "127.0.0.1", port: 1080 }), "SOCKS5 127.0.0.1:1080");
});

test("builds a flag from ISO country code", () => {
  assert.equal(countryFlag("de"), "🇩🇪");
  assert.equal(countryFlag(""), "🌐");
});

test("infers a declared country from node names and flag emoji", () => {
  assert.equal(inferCountryCodeFromName("HK ⭐ Гонконг"), "HK");
  assert.equal(inferCountryCodeFromName("🇩🇪 Германия · Hysteria 2"), "DE");
  assert.equal(inferCountryCodeFromName("Авто · Самый быстрый"), "");
});
