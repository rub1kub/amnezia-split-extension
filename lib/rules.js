import { pacProxyDirective } from "./proxy.js";
import { RU_BASE_SUFFIXES, ruDomainMatches, ruIpMatches } from "./ru-policy.js";

export const DOMAIN_SOURCES = Object.freeze([
  Object.freeze({
    id: "itdog",
    name: "itdoginfo — Россия",
    url: "https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Russia/inside-raw.lst",
    minimum: 500
  }),
  Object.freeze({
    id: "refilter",
    name: "Re-filter — сообщество",
    url: "https://raw.githubusercontent.com/1andrevich/Re-filter-lists/main/community.lst",
    minimum: 100
  }),
  Object.freeze({
    id: "google-ai",
    name: "itdoginfo — Google AI",
    url: "https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Services/google_ai.lst",
    minimum: 5
  })
]);

export const CORE_DOMAINS = Object.freeze([
  "chatgpt.com",
  "openai.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "sora.com"
]);

export function normalizeDomain(input) {
  let value = String(input ?? "").trim().toLowerCase();
  if (!value) return "";

  value = value
    .replace(/^domain-suffix,/i, "")
    .replace(/^\|\|/, "")
    .replace(/^\*\./, "")
    .replace(/^\.+/, "")
    .replace(/\^$/, "")
    .replace(/\.+$/, "");

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return "";
    }
  } else {
    value = value.split(/[/?#]/, 1)[0].split(":", 1)[0];
  }

  try {
    value = new URL(`http://${value}`).hostname;
  } catch {
    return "";
  }

  if (
    !value ||
    value.length > 253 ||
    value.includes("..") ||
    !/^[a-z0-9.-]+$/.test(value)
  ) {
    return "";
  }

  return value;
}

export function parseDomainList(text) {
  const domains = new Set();
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const domain = normalizeDomain(line);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

export function domainMatches(host, domain) {
  const normalizedHost = normalizeDomain(host);
  const normalizedDomain = normalizeDomain(domain);
  return Boolean(
    normalizedHost &&
      normalizedDomain &&
      (normalizedHost === normalizedDomain ||
        normalizedHost.endsWith(`.${normalizedDomain}`))
  );
}

export function effectiveDomains(state) {
  const routed = new Set(CORE_DOMAINS);
  if (state.useCommunityList) {
    for (const domain of state.communityDomains ?? []) routed.add(domain);
  }
  for (const domain of state.customDomains ?? []) routed.add(domain);

  const bypass = new Set((state.bypassDomains ?? []).map(normalizeDomain).filter(Boolean));
  return [...routed]
    .filter((domain) => ![...bypass].some((item) => domainMatches(domain, item)))
    .filter((domain) => !ruDomainMatches(domain, state.ruPolicy))
    .sort();
}

export function routeSource(host, state) {
  const normalizedHost = normalizeDomain(host);
  if (ruDomainMatches(normalizedHost, state.ruPolicy) || ruIpMatches(normalizedHost, state.ruPolicy)) return "direct";
  if ((state.bypassDomains ?? []).some((domain) => domainMatches(host, domain))) {
    return "direct";
  }
  if (state.routeMode === "all") return "all";
  if ((state.customDomains ?? []).some((domain) => domainMatches(host, domain))) {
    return "custom";
  }
  if (CORE_DOMAINS.some((domain) => domainMatches(host, domain))) return "core";
  if (
    state.useCommunityList &&
    (state.communityDomains ?? []).some((domain) => domainMatches(host, domain))
  ) {
    return "community";
  }
  return "direct";
}

export function generatePac({ domains, bypassDomains, proxyHost, proxyPort, proxyScheme = "https", routeMode = "selected", configRevision = 0, ruPolicy = null }) {
  const routeMap = Object.fromEntries(domains.map((domain) => [domain, 1]));
  const bypassMap = Object.fromEntries(
    (bypassDomains ?? []).map(normalizeDomain).filter(Boolean).map((domain) => [domain, 1])
  );
  const proxy = pacProxyDirective({
    scheme: proxyScheme,
    host: proxyHost,
    port: Number(proxyPort)
  });

  return `
var ROUTE = ${JSON.stringify(routeMap)};
var BYPASS = ${JSON.stringify(bypassMap)};
var ROUTE_ALL = ${routeMode === "all" ? "true" : "false"};
var CONFIG_REVISION = ${Number(configRevision) || 0};
var RU_SUFFIX = ${JSON.stringify(Object.fromEntries((ruPolicy?.domainSuffixes || RU_BASE_SUFFIXES).map((d) => [d, 1])))};
var RU_EXACT = ${JSON.stringify(Object.fromEntries((ruPolicy?.exactDomains || []).map((d) => [d, 1])))};
var RU_IP4 = ${JSON.stringify(ruPolicy?.ipv4Ranges || [])};
var RU_IP6 = ${JSON.stringify(ruPolicy?.ipv6Cidrs || [])};
var KEEP_PROXY = ${JSON.stringify(Object.fromEntries([...CORE_DOMAINS, "youtube.com", "googlevideo.com", "claude.ai", "telegram.org", "t.me", "discord.com", "instagram.com", "whatsapp.com", "1.1.1.1"].map((d) => [d, 1])))};

function ruIPv4(ip) {
  if (!/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(ip || "")) return false;
  var p = ip.split("."), n = 0;
  for (var k = 0; k < 4; k++) { if (Number(p[k]) > 255) return false; n = n * 256 + Number(p[k]); }
  var lo = 0, hi = RU_IP4.length - 1;
  while (lo <= hi) {
    var m = (lo + hi) >>> 1;
    if (n < RU_IP4[m][0]) hi = m - 1;
    else if (n > RU_IP4[m][1]) lo = m + 1;
    else return true;
  }
  return false;
}

function ipv6Words(ip) {
  ip = ip.replace(/^\\[/, "").replace(/\\]$/, "");
  if (!/^[a-f0-9:]+$/.test(ip)) return null;
  var halves = ip.split("::");
  if (halves.length > 2) return null;
  var left = halves[0] ? halves[0].split(":") : [];
  var right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  var missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  while (missing-- > 0) left.push("0");
  var all = left.concat(right), out = [];
  for (var i = 0; i < all.length; i++) { if (!/^[a-f0-9]{1,4}$/.test(all[i])) return null; out.push(parseInt(all[i], 16)); }
  return out.length === 8 ? out : null;
}

function ruIPv6(ip) {
  var value = ipv6Words(ip);
  if (!value) return false;
  for (var n = 0; n < RU_IP6.length; n++) {
    var entry = RU_IP6[n].split("/"), network = ipv6Words(entry[0]), bits = Number(entry[1]), matches = !!network;
    for (var w = 0; matches && bits > 0 && w < 8; w++, bits -= 16) {
      var width = Math.min(bits, 16), mask = (65535 << (16 - width)) & 65535;
      if ((value[w] & mask) !== (network[w] & mask)) matches = false;
    }
    if (matches) return true;
  }
  return false;
}

function FindProxyForURL(url, host) {
  host = host.toLowerCase().replace(/\\.$/, "");
  if ((host.indexOf(":") === -1 && isPlainHostName(host)) || host === "localhost") return "DIRECT";

  var labels = host.split(".");
  var candidates = [];
  for (var i = 0; i < labels.length; i++) {
    candidates.push(labels.slice(i).join("."));
  }

  for (var b = 0; b < candidates.length; b++) {
    if (BYPASS[candidates[b]]) return "DIRECT";
  }
  if (RU_EXACT[host]) return "DIRECT";
  for (var s = 0; s < candidates.length; s++) { if (RU_SUFFIX[candidates[s]]) return "DIRECT"; }
  var shouldProxy = ROUTE_ALL;
  for (var q = 0; q < candidates.length; q++) { if (ROUTE[candidates[q]]) shouldProxy = true; }
  if (!shouldProxy) return "DIRECT";
  for (var f = 0; f < candidates.length; f++) { if (KEEP_PROXY[candidates[f]]) return ${JSON.stringify(proxy)}; }
  if (host.indexOf(":") !== -1) { if (ruIPv6(host)) return "DIRECT"; }
  else if (RU_IP4.length) {
    var resolved = null;
    try { resolved = /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host) ? host : dnsResolve(host); } catch (e) {}
    if (ruIPv4(resolved)) return "DIRECT";
  }
  if (ROUTE_ALL) return ${JSON.stringify(proxy)};
  for (var r = 0; r < candidates.length; r++) {
    if (ROUTE[candidates[r]]) return ${JSON.stringify(proxy)};
  }
  return "DIRECT";
}`.trim();
}
