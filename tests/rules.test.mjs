import test from "node:test";
import assert from "node:assert/strict";
import {
  domainMatches,
  effectiveDomains,
  generatePac,
  normalizeDomain,
  parseDomainList,
  routeSource
} from "../lib/rules.js";

test("normalizes URLs, wildcard rules and Unicode domains", () => {
  assert.equal(normalizeDomain("https://WWW.OpenAI.com/path"), "www.openai.com");
  assert.equal(normalizeDomain("*.chatgpt.com"), "chatgpt.com");
  assert.equal(normalizeDomain("DOMAIN-SUFFIX,example.com"), "example.com");
  assert.equal(normalizeDomain("пример.рф"), "xn--e1afmkfd.xn--p1ai");
});

test("parses and deduplicates raw lists", () => {
  assert.deepEqual(parseDomainList("# source\n.openai.com\nopenai.com\nchatgpt.com\n"), [
    "chatgpt.com",
    "openai.com"
  ]);
});

test("matches a domain and all of its subdomains, not lookalikes", () => {
  assert.equal(domainMatches("chatgpt.com", "chatgpt.com"), true);
  assert.equal(domainMatches("auth.chatgpt.com", "chatgpt.com"), true);
  assert.equal(domainMatches("notchatgpt.com", "chatgpt.com"), false);
});

test("bypass rules win over core and community rules", () => {
  const state = {
    useCommunityList: true,
    communityDomains: ["example.com"],
    customDomains: [],
    bypassDomains: ["chatgpt.com"]
  };
  assert.equal(routeSource("chatgpt.com", state), "direct");
  assert.equal(routeSource("example.com", state), "community");
  assert.equal(effectiveDomains(state).includes("chatgpt.com"), false);
});

test("PAC routes selected suffixes over HTTPS and defaults to direct", () => {
  const pac = generatePac({
    domains: ["openai.com"],
    bypassDomains: ["status.openai.com"],
    proxyHost: "proxy.example.com",
    proxyPort: 18443
  });
  const findProxy = new Function(`${pac}; return FindProxyForURL;`)();
  globalThis.isPlainHostName = (host) => !host.includes(".");
  assert.equal(findProxy("https://chat.openai.com", "chat.openai.com"), "HTTPS proxy.example.com:18443");
  assert.equal(findProxy("https://status.openai.com", "status.openai.com"), "DIRECT");
  assert.equal(findProxy("https://example.org", "example.org"), "DIRECT");
});
