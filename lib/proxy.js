export const DIRECT_PROXY_SCHEMES = Object.freeze({
  http: Object.freeze({ label: "HTTP", pac: "PROXY", defaultPort: 80 }),
  https: Object.freeze({ label: "HTTPS", pac: "HTTPS", defaultPort: 443 }),
  socks4: Object.freeze({ label: "SOCKS4", pac: "SOCKS", defaultPort: 1080 }),
  socks5: Object.freeze({ label: "SOCKS5", pac: "SOCKS5", defaultPort: 1080 })
});

export const COMPANION_PROTOCOLS = Object.freeze({
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  ss: "Shadowsocks",
  hysteria2: "Hysteria 2",
  tuic: "TUIC",
  wireguard: "WireGuard",
  amneziawg: "AmneziaWG"
});

const SCHEME_ALIASES = Object.freeze({
  proxy: "http",
  socks: "socks5",
  hy2: "hysteria2",
  hysteria: "hysteria2",
  wg: "wireguard",
  awg: "amneziawg"
});

export function normalizeProxyScheme(value, fallback = "https") {
  const raw = String(value ?? "").trim().toLowerCase().replace(/:$/, "");
  const normalized = SCHEME_ALIASES[raw] ?? raw;
  return DIRECT_PROXY_SCHEMES[normalized] ? normalized : fallback;
}

export function normalizeProtocol(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/:$/, "");
  return SCHEME_ALIASES[raw] ?? raw;
}

export function isDirectProxyProtocol(value) {
  return Boolean(DIRECT_PROXY_SCHEMES[normalizeProtocol(value)]);
}

export function protocolLabel(value) {
  const protocol = normalizeProtocol(value);
  return DIRECT_PROXY_SCHEMES[protocol]?.label ?? COMPANION_PROTOCOLS[protocol] ?? protocol.toUpperCase();
}

export function pacProxyDirective(server) {
  const scheme = normalizeProxyScheme(server?.scheme);
  const host = String(server?.host ?? "").trim();
  const port = Number(server?.port) || DIRECT_PROXY_SCHEMES[scheme].defaultPort;
  return `${DIRECT_PROXY_SCHEMES[scheme].pac} ${host}:${port}`;
}

export function normalizeCountryCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

export function countryFlag(value) {
  const code = normalizeCountryCode(value);
  return code
    ? String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)))
    : "🌐";
}

export function countryName(value, locale = "ru") {
  const code = normalizeCountryCode(value);
  if (!code) return "Страна не определена";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
