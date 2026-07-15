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
    .sort();
}

export function routeSource(host, state) {
  if ((state.bypassDomains ?? []).some((domain) => domainMatches(host, domain))) {
    return "direct";
  }
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

export function generatePac({ domains, bypassDomains, proxyHost, proxyPort }) {
  const routeMap = Object.fromEntries(domains.map((domain) => [domain, 1]));
  const bypassMap = Object.fromEntries(
    (bypassDomains ?? []).map(normalizeDomain).filter(Boolean).map((domain) => [domain, 1])
  );
  const proxy = `HTTPS ${proxyHost}:${Number(proxyPort)}`;

  return `
var ROUTE = ${JSON.stringify(routeMap)};
var BYPASS = ${JSON.stringify(bypassMap)};

function FindProxyForURL(url, host) {
  host = host.toLowerCase().replace(/\\.$/, "");
  if (isPlainHostName(host) || host === "localhost") return "DIRECT";

  var labels = host.split(".");
  var candidates = [];
  for (var i = 0; i < labels.length; i++) {
    candidates.push(labels.slice(i).join("."));
  }

  for (var b = 0; b < candidates.length; b++) {
    if (BYPASS[candidates[b]]) return "DIRECT";
  }
  for (var r = 0; r < candidates.length; r++) {
    if (ROUTE[candidates[r]]) return ${JSON.stringify(proxy)};
  }
  return "DIRECT";
}`.trim();
}
