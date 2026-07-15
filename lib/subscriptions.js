import {
  isDirectProxyProtocol,
  normalizeProtocol,
  normalizeProxyScheme,
  protocolLabel
} from "./proxy.js";

const URI_PROTOCOLS = new Set([
  "http", "https", "socks", "socks4", "socks5", "vless", "vmess", "trojan",
  "ss", "hysteria", "hysteria2", "hy2", "tuic", "wireguard", "wg", "amneziawg", "awg"
]);

function decodeBase64(value) {
  const normalized = String(value ?? "").trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || !/^[a-z0-9+/=\s]+$/i.test(normalized)) return "";
  const padded = normalized.replace(/\s+/g, "") + "=".repeat((4 - (normalized.replace(/\s+/g, "").length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function nodeName(url, fallback) {
  const fromHash = safeDecode(url.hash.replace(/^#/, "")).trim();
  return fromHash || safeDecode(url.searchParams.get("name") || url.searchParams.get("remarks") || "").trim() || fallback;
}

function normalizeNode(node, index) {
  const protocol = normalizeProtocol(node.protocol);
  const host = String(node.host ?? "").trim().toLowerCase();
  const port = Number(node.port) || 0;
  const compatible = isDirectProxyProtocol(protocol);
  return {
    key: String(node.key || `${protocol}:${host}:${port}:${node.name || index}`),
    name: String(node.name || `${protocolLabel(protocol)} ${index + 1}`).trim(),
    protocol,
    protocolLabel: protocolLabel(protocol),
    host,
    port,
    username: compatible ? String(node.username ?? "") : "",
    password: compatible ? String(node.password ?? "") : "",
    compatible,
    requiresCompanion: !compatible
  };
}

function parseVmess(value, index) {
  const decoded = decodeBase64(value.replace(/^vmess:\/\//i, ""));
  if (!decoded) return null;
  try {
    const data = JSON.parse(decoded);
    return normalizeNode({
      protocol: "vmess",
      name: data.ps,
      host: data.add,
      port: data.port,
      key: `vmess:${data.add}:${data.port}:${data.id || index}`
    }, index);
  } catch {
    return null;
  }
}

function parseShadowsocks(value, index) {
  const input = String(value ?? "").trim();
  const hashIndex = input.indexOf("#");
  const hash = hashIndex >= 0 ? input.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const payload = withoutHash.replace(/^ss:\/\//i, "");
  const queryIndex = payload.indexOf("?");
  const authority = queryIndex >= 0 ? payload.slice(0, queryIndex) : payload;
  const query = queryIndex >= 0 ? payload.slice(queryIndex) : "";
  const expanded = authority.includes("@") ? authority : decodeBase64(authority);
  if (!expanded || !expanded.includes("@")) return null;
  try {
    const url = new URL(`ss://${expanded}${query}${hash}`);
    return normalizeNode({
      protocol: "ss",
      name: nodeName(url, url.hostname ? `Shadowsocks · ${url.hostname}` : `Shadowsocks ${index + 1}`),
      host: url.hostname,
      port: url.port,
      key: `ss:${url.hostname}:${url.port}:${safeDecode(url.username)}`
    }, index);
  } catch {
    return null;
  }
}

export function parseProxyUri(value, index = 0) {
  const input = String(value ?? "").trim();
  const rawProtocol = input.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (!rawProtocol || !URI_PROTOCOLS.has(rawProtocol)) return null;
  if (rawProtocol === "vmess") return parseVmess(input, index);
  if (rawProtocol === "ss") return parseShadowsocks(input, index);

  try {
    const url = new URL(input);
    const protocol = normalizeProtocol(rawProtocol);
    const host = url.hostname;
    const fallbackName = host ? `${protocolLabel(protocol)} · ${host}` : `${protocolLabel(protocol)} ${index + 1}`;
    return normalizeNode({
      protocol,
      name: nodeName(url, fallbackName),
      host,
      port: url.port,
      username: safeDecode(url.username),
      password: safeDecode(url.password),
      key: `${protocol}:${host}:${url.port}:${safeDecode(url.username)}`
    }, index);
  } catch {
    return null;
  }
}

function parseJsonSubscription(text) {
  try {
    const data = JSON.parse(text);
    const candidates = Array.isArray(data)
      ? data
      : Array.isArray(data.outbounds)
        ? data.outbounds
        : Array.isArray(data.proxies)
          ? data.proxies
          : [];
    return candidates.map((item, index) => normalizeNode({
      protocol: item.type || item.protocol,
      name: item.tag || item.name,
      host: item.server || item.host,
      port: item.server_port || item.port,
      username: item.username,
      password: item.password,
      key: `${item.type || item.protocol}:${item.server || item.host}:${item.server_port || item.port}:${item.tag || item.name || index}`
    }, index)).filter((node) => node.protocol && node.host && node.port);
  } catch {
    return [];
  }
}

function parseSimpleClashYaml(text) {
  if (!/^proxies\s*:/im.test(text)) return [];
  const blocks = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const inline = line.match(/^-\s*\{(.+)\}\s*$/);
    if (inline) {
      if (current) blocks.push(current);
      current = {};
      for (const field of inline[1].split(/,(?=(?:[^'"]|'[^']*'|"[^"]*")*$)/)) {
        const match = field.trim().match(/^([a-z_][a-z0-9_-]*)\s*:\s*(.+)$/i);
        if (match) current[match[1].replace(/-/g, "_")] = match[2].trim().replace(/^['"]|['"]$/g, "");
      }
      blocks.push(current);
      current = null;
      continue;
    }
    const firstField = line.match(/^-\s+([a-z_][a-z0-9_-]*)\s*:\s*(.+)$/i);
    if (firstField) {
      if (current) blocks.push(current);
      current = {
        [firstField[1].replace(/-/g, "_")]: firstField[2].replace(/^['"]|['"]$/g, "")
      };
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([a-z_][a-z0-9_-]*)\s*:\s*(.+)$/i);
    if (!match) continue;
    current[match[1].replace(/-/g, "_")] = match[2].replace(/^['"]|['"]$/g, "");
  }
  if (current) blocks.push(current);
  return blocks.map((item, index) => normalizeNode({
    protocol: item.type,
    name: item.name,
    host: item.server,
    port: item.port,
    username: item.username,
    password: item.password,
    key: `${item.type}:${item.server}:${item.port}:${item.name || index}`
  }, index)).filter((node) => node.protocol && node.host && node.port);
}

function extractUriLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .flatMap((line) => line.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi) ?? []);
}

export function parseSubscription(input) {
  let text = String(input ?? "").trim();
  if (!text) return { nodes: [], protocols: [], compatibleCount: 0, companionCount: 0 };

  if (!/:\/\//.test(text) && !/^[\[{]/.test(text)) {
    const decoded = decodeBase64(text);
    if (decoded && (/:\/\//.test(decoded) || /^[\[{]/.test(decoded.trim()) || /^proxies\s*:/im.test(decoded))) {
      text = decoded.trim();
    }
  }

  let nodes = parseJsonSubscription(text);
  if (!nodes.length) nodes = parseSimpleClashYaml(text);
  if (!nodes.length) {
    nodes = extractUriLines(text)
      .map((line, index) => parseProxyUri(line, index))
      .filter(Boolean);
  }

  const unique = [];
  const seen = new Set();
  for (const node of nodes) {
    if (!node.host || !node.port || seen.has(node.key)) continue;
    seen.add(node.key);
    unique.push(node);
  }
  const protocols = [...new Set(unique.map((node) => node.protocol))].sort();
  return {
    nodes: unique,
    protocols,
    compatibleCount: unique.filter((node) => node.compatible).length,
    companionCount: unique.filter((node) => node.requiresCompanion).length
  };
}

export function subscriptionNodeToServer(node, subscriptionId, id = crypto.randomUUID()) {
  if (!node?.compatible) return null;
  return {
    id,
    name: node.name,
    host: node.host,
    port: Number(node.port),
    username: node.username || "",
    password: node.password || "",
    scheme: normalizeProxyScheme(node.protocol),
    protocol: normalizeProtocol(node.protocol),
    source: "subscription",
    subscriptionId,
    sourceNodeKey: node.key,
    countryCode: "",
    countryName: "",
    exitIp: ""
  };
}
