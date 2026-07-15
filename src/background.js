import {
  CORE_DOMAINS,
  DOMAIN_SOURCES,
  domainMatches,
  effectiveDomains,
  generatePac,
  normalizeDomain,
  parseDomainList,
  routeSource
} from "../lib/rules.js";
import { compareVersions, releaseUrl } from "../lib/version.js";
import {
  countryFlag,
  countryName,
  DIRECT_PROXY_SCHEMES,
  normalizeCountryCode,
  normalizeProxyScheme,
  protocolLabel
} from "../lib/proxy.js";
import { parseSubscription, subscriptionNodeToServer } from "../lib/subscriptions.js";

const COUNTRY_SERVICES = Object.freeze([
  Object.freeze({ url: "https://api.country.is/", ip: "ip", country: "country" }),
  Object.freeze({ url: "https://ipwho.is/", ip: "ip", country: "country_code" })
]);
const INTERNAL_PROXY_DOMAINS = Object.freeze(COUNTRY_SERVICES.map((service) => new URL(service.url).hostname));
const VERSION_FEED_URL = "https://raw.githubusercontent.com/rub1kub/amnezia-split-extension/main/release.json";

const DEFAULT_SERVER = Object.freeze({
  id: "server-1",
  name: "Основной сервер",
  host: "ton4.pro",
  port: 18443,
  username: "amnezia-browser",
  password: "",
  scheme: "https",
  protocol: "https",
  source: "manual",
  subscriptionId: null,
  sourceNodeKey: null,
  countryCode: "",
  countryName: "",
  exitIp: ""
});

const DEFAULT_STATE = Object.freeze({
  enabled: true,
  configured: false,
  routeMode: "selected",
  useCommunityList: true,
  communityDomains: [],
  communitySources: [],
  communityUpdatedAt: null,
  customDomains: [],
  bypassDomains: [],
  activeServerId: DEFAULT_SERVER.id,
  servers: [DEFAULT_SERVER],
  subscriptions: [],
  updateNotice: null,
  dismissedUpdateVersion: null,
  lastError: null
});

let stateCache = null;
const proxyAuthAttempts = new Map();

function normalizeServer(server = {}, fallbackId = "server-1", fallbackName = "Сервер") {
  const scheme = normalizeProxyScheme(server.scheme || server.protocol || "https");
  const countryCode = normalizeCountryCode(server.countryCode);
  return {
    id: String(server.id || fallbackId),
    name: String(server.name || fallbackName).trim() || fallbackName,
    host: String(server.host || "").trim().toLowerCase(),
    port: Number(server.port) || 0,
    username: String(server.username || "").trim(),
    password: String(server.password || ""),
    scheme,
    protocol: String(server.protocol || scheme).trim().toLowerCase(),
    source: server.source === "subscription" ? "subscription" : "manual",
    subscriptionId: server.subscriptionId ? String(server.subscriptionId) : null,
    sourceNodeKey: server.sourceNodeKey ? String(server.sourceNodeKey) : null,
    countryCode,
    countryName: String(server.countryName || (countryCode ? countryName(countryCode) : "")),
    exitIp: String(server.exitIp || "")
  };
}

function normalizeSubscription(subscription = {}) {
  return {
    id: String(subscription.id || crypto.randomUUID()),
    name: String(subscription.name || "Подписка").trim() || "Подписка",
    url: String(subscription.url || "").trim(),
    origin: String(subscription.origin || ""),
    updatedAt: subscription.updatedAt || null,
    nodeCount: Number(subscription.nodeCount) || 0,
    compatibleCount: Number(subscription.compatibleCount) || 0,
    companionCount: Number(subscription.companionCount) || 0,
    protocols: [...(subscription.protocols ?? [])],
    nodes: [...(subscription.nodes ?? [])],
    lastError: subscription.lastError ? String(subscription.lastError) : null
  };
}

function mergeState(saved = {}) {
  const sourceServers = Array.isArray(saved.servers) && saved.servers.length
    ? saved.servers
    : saved.proxy
      ? [{ ...saved.proxy, id: "server-1", name: "Основной сервер" }]
      : [DEFAULT_SERVER];
  const servers = sourceServers.map((server, index) =>
    normalizeServer(server, `server-${index + 1}`, `Сервер ${index + 1}`)
  );
  const activeServerId = servers.some((server) => server.id === saved.activeServerId)
    ? saved.activeServerId
    : servers[0].id;

  return {
    ...DEFAULT_STATE,
    ...saved,
    routeMode: saved.routeMode === "all" ? "all" : "selected",
    servers,
    activeServerId,
    communityDomains: [...(saved.communityDomains ?? [])],
    communitySources: [...(saved.communitySources ?? [])],
    customDomains: [...(saved.customDomains ?? [])],
    bypassDomains: [...(saved.bypassDomains ?? [])],
    subscriptions: (saved.subscriptions ?? []).map(normalizeSubscription)
  };
}

function getActiveServer(state) {
  return state.servers.find((server) => server.id === state.activeServerId) ?? state.servers[0];
}

function isServerConfigured(server) {
  if (!server?.host || Number(server.port) <= 0 || !DIRECT_PROXY_SCHEMES[normalizeProxyScheme(server.scheme)]) {
    return false;
  }
  return Boolean(server.username) === Boolean(server.password);
}

async function getState() {
  if (stateCache) return stateCache;
  const { state } = await chrome.storage.local.get("state");
  stateCache = mergeState(state);
  return stateCache;
}

async function saveState(nextState) {
  stateCache = mergeState(nextState);
  await chrome.storage.local.set({ state: stateCache });
  return stateCache;
}

async function loadBundledDomains() {
  const response = await fetch(chrome.runtime.getURL("data/inside-raw.lst"));
  if (!response.ok) throw new Error("Не удалось открыть встроенный список сайтов");
  return parseDomainList(await response.text());
}

async function initialize() {
  let state = await getState();
  if (state.communityDomains.length === 0) {
    const communityDomains = await loadBundledDomains();
    state = await saveState({
      ...state,
      communityDomains,
      communitySources: [{ id: "bundled", name: "Встроенный список", count: communityDomains.length }],
      communityUpdatedAt: "2026-07-15T00:00:00.000Z"
    });
  }
  await chrome.alarms.create("refresh-community-list", { periodInMinutes: 24 * 60 });
  await chrome.alarms.create("check-extension-update", { periodInMinutes: 6 * 60 });
  await applyProxy(state);
  const updatedAt = state.communityUpdatedAt ? new Date(state.communityUpdatedAt).getTime() : 0;
  const needsSources = state.communitySources.length < DOMAIN_SOURCES.length;
  if (needsSources || Date.now() - updatedAt > 24 * 60 * 60 * 1000) {
    updateCommunityList().catch(() => {});
  }
  checkForExtensionUpdate().catch(() => {});
  return state;
}

async function setBadge(state) {
  const active = state.enabled && isServerConfigured(getActiveServer(state));
  const notice = state.updateNotice;
  const badge = notice ? (notice.kind === "available" ? "NEW" : "✓") : active ? "ON" : "";
  const badgeColor = notice ? "#6F5BE7" : active ? "#14A27A" : "#8A93A3";
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  await chrome.action.setTitle({
    title: notice
      ? notice.kind === "available"
        ? `Доступно обновление ${notice.version}`
        : `Обновлено до ${notice.version}`
      : active
        ? "Routeva включена"
        : "Routeva выключена"
  });
}

async function applyProxy(providedState) {
  const state = providedState ?? (await getState());
  const server = getActiveServer(state);
  if (!state.enabled || !isServerConfigured(server)) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await setBadge(state);
    return;
  }

  const domains = [...new Set([...effectiveDomains(state), ...INTERNAL_PROXY_DOMAINS])];
  const pac = generatePac({
    domains,
    bypassDomains: state.bypassDomains,
    proxyHost: server.host,
    proxyPort: server.port,
    proxyScheme: server.scheme,
    routeMode: state.routeMode
  });

  await chrome.proxy.settings.set({
    value: {
      mode: "pac_script",
      pacScript: { data: pac, mandatory: true }
    },
    scope: "regular"
  });
  await setBadge(state);
}

async function updateCommunityList() {
  const fetched = await Promise.all(
    DOMAIN_SOURCES.map(async (source) => {
      const response = await fetch(`${source.url}?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
      const domains = parseDomainList(await response.text());
      if (domains.length < source.minimum) {
        throw new Error(`${source.name}: получен подозрительно короткий список`);
      }
      return { ...source, domains };
    })
  );
  const domains = [...new Set(fetched.flatMap((source) => source.domains))].sort();
  const communitySources = fetched.map((source) => ({
    id: source.id,
    name: source.name,
    count: source.domains.length
  }));

  const state = await getState();
  const next = await saveState({
    ...state,
    communityDomains: domains,
    communitySources,
    communityUpdatedAt: new Date().toISOString(),
    lastError: null
  });
  await applyProxy(next);
  return { count: domains.length, sources: communitySources, updatedAt: next.communityUpdatedAt };
}

function publicUpdateNotice(state) {
  if (!state.updateNotice || state.dismissedUpdateVersion === state.updateNotice.version) return null;
  return { ...state.updateNotice };
}

async function broadcastUpdateNotice(notice) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, {
      type: "updateNoticeChanged",
      notice
    }))
  );
}

async function checkForExtensionUpdate() {
  const manifest = chrome.runtime.getManifest();
  const response = await fetch(`${VERSION_FEED_URL}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Проверка обновления: HTTP ${response.status}`);
  const feed = await response.json();
  const remoteVersion = String(feed.version || "");
  if (!remoteVersion) throw new Error("Не удалось прочитать версию обновления");

  const state = await getState();
  if (compareVersions(remoteVersion, manifest.version) <= 0) return publicUpdateNotice(state);
  if (state.dismissedUpdateVersion === remoteVersion) return null;
  if (state.updateNotice?.kind === "available" && state.updateNotice.version === remoteVersion) {
    return publicUpdateNotice(state);
  }

  const notice = {
    kind: "available",
    version: remoteVersion,
    url: String(feed.url || releaseUrl(remoteVersion))
  };
  const next = await saveState({ ...state, updateNotice: notice });
  await setBadge(next);
  await broadcastUpdateNotice(notice);
  return notice;
}

async function setInstalledUpdateNotice(previousVersion) {
  const version = chrome.runtime.getManifest().version;
  const state = await getState();
  const notice = {
    kind: "installed",
    version,
    previousVersion: previousVersion ?? null,
    url: releaseUrl(version)
  };
  const next = await saveState({
    ...state,
    updateNotice: notice,
    dismissedUpdateVersion: null
  });
  await setBadge(next);
  await broadcastUpdateNotice(notice);
}

async function dismissUpdateNotice() {
  const state = await getState();
  const version = state.updateNotice?.version ?? null;
  const next = await saveState({
    ...state,
    updateNotice: null,
    dismissedUpdateVersion: version
  });
  await setBadge(next);
  await broadcastUpdateNotice(null);
  return { dismissed: Boolean(version) };
}

async function toggleDomain(host) {
  const domain = normalizeDomain(host);
  if (!domain) throw new Error("Эту страницу нельзя добавить в правила");
  const state = await getState();
  const routed = routeSource(domain, state) !== "direct";
  let customDomains = [...state.customDomains];
  let bypassDomains = [...state.bypassDomains];

  if (routed) {
    customDomains = customDomains.filter((item) => item !== domain);
    if (!bypassDomains.includes(domain)) bypassDomains.push(domain);
  } else {
    bypassDomains = bypassDomains.filter((item) => !domainMatches(domain, item));
    if (!customDomains.includes(domain)) customDomains.push(domain);
  }

  const next = await saveState({ ...state, customDomains, bypassDomains });
  await applyProxy(next);
  return getPublicStatus(domain, next);
}

async function saveServer(serverInput) {
  const state = await getState();
  const existing = state.servers.find((server) => server.id === serverInput.id);
  const id = existing?.id || crypto.randomUUID();
  const name = String(serverInput.name ?? existing?.name ?? `Сервер ${state.servers.length + 1}`).trim();
  const host = String(serverInput.host ?? "").trim().toLowerCase();
  const port = Number(serverInput.port);
  const username = String(serverInput.username ?? "").trim();
  const password = String(serverInput.password ?? "");
  const scheme = normalizeProxyScheme(serverInput.scheme || existing?.scheme || "https");
  if (!name) throw new Error("Введите название сервера");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Проверьте адрес сервера и порт");
  }
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("Укажите и логин, и пароль — либо оставьте оба поля пустыми");
  }

  const server = normalizeServer({
    ...existing,
    id,
    name,
    host,
    port,
    username,
    password,
    scheme,
    protocol: scheme,
    source: "manual",
    subscriptionId: null,
    sourceNodeKey: null,
    countryCode: host === existing?.host && port === existing?.port && scheme === existing?.scheme
      ? existing.countryCode
      : "",
    countryName: host === existing?.host && port === existing?.port && scheme === existing?.scheme
      ? existing.countryName
      : "",
    exitIp: host === existing?.host && port === existing?.port && scheme === existing?.scheme
      ? existing.exitIp
      : ""
  });
  const servers = existing
    ? state.servers.map((item) => (item.id === id ? server : item))
    : [...state.servers, server];
  const next = await saveState({
    ...state,
    servers,
    activeServerId: id,
    configured: true,
    enabled: true,
    lastError: null
  });
  await applyProxy(next);
  return getPublicStatus(null, next, true);
}

async function selectServer(id) {
  const state = await getState();
  const server = state.servers.find((item) => item.id === id);
  if (!server) throw new Error("Сервер не найден");
  const next = await saveState({
    ...state,
    activeServerId: server.id,
    configured: isServerConfigured(server),
    lastError: null
  });
  await applyProxy(next);
  const located = await probeActiveServerLocation(next).catch(() => next);
  return getPublicStatus(null, located, true);
}

async function deleteServer(id) {
  const state = await getState();
  if (state.servers.length <= 1) throw new Error("Оставьте хотя бы один сервер");
  const servers = state.servers.filter((server) => server.id !== id);
  if (servers.length === state.servers.length) throw new Error("Сервер не найден");
  const activeServerId = state.activeServerId === id ? servers[0].id : state.activeServerId;
  const activeServer = servers.find((server) => server.id === activeServerId) ?? servers[0];
  const next = await saveState({
    ...state,
    servers,
    activeServerId: activeServer.id,
    configured: isServerConfigured(activeServer),
    lastError: null
  });
  await applyProxy(next);
  return getPublicStatus(null, next, true);
}

async function fetchCountry(marker) {
  let lastError = null;
  for (const service of COUNTRY_SERVICES) {
    try {
      const url = new URL(service.url);
      url.searchParams.set(marker, Date.now());
      const response = await fetch(url.href, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const code = normalizeCountryCode(data[service.country]);
      if (!data[service.ip] || !code) throw new Error("неполный ответ");
      return {
        ip: String(data[service.ip]),
        countryCode: code,
        countryName: countryName(code),
        flag: countryFlag(code)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Не удалось определить страну IP${lastError?.message ? `: ${lastError.message}` : ""}`);
}

async function saveServerLocation(state, serverId, location) {
  const servers = state.servers.map((server) => server.id === serverId
    ? normalizeServer({
        ...server,
        countryCode: location.countryCode,
        countryName: location.countryName,
        exitIp: location.ip
      })
    : server);
  return saveState({ ...state, servers, lastError: null });
}

async function probeActiveServerLocation(providedState) {
  const state = providedState ?? (await getState());
  const server = getActiveServer(state);
  if (!state.enabled || !isServerConfigured(server)) return state;
  await applyProxy(state);
  const location = await fetchCountry("probe");
  return saveServerLocation(state, server.id, location);
}

async function testProxy() {
  let state = await getState();
  const server = getActiveServer(state);
  if (!isServerConfigured(server)) throw new Error("Сначала сохраните данные подключения");
  try {
    await chrome.proxy.settings.clear({ scope: "regular" });
    const direct = await fetchCountry("direct");

    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: server.scheme,
            host: server.host,
            port: Number(server.port)
          }
        }
      },
      scope: "regular"
    });
    const proxied = await fetchCountry("proxy");
    state = await saveServerLocation(state, server.id, proxied);
    return {
      directIp: direct.ip,
      proxyIp: proxied.ip,
      countryCode: proxied.countryCode,
      countryName: proxied.countryName,
      flag: proxied.flag
    };
  } finally {
    await applyProxy(state);
  }
}

function subscriptionSummary(subscription, includeUrl = false) {
  return {
    id: subscription.id,
    name: subscription.name,
    origin: subscription.origin,
    updatedAt: subscription.updatedAt,
    nodeCount: subscription.nodeCount,
    compatibleCount: subscription.compatibleCount,
    companionCount: subscription.companionCount,
    protocols: subscription.protocols,
    nodes: subscription.nodes,
    lastError: subscription.lastError,
    ...(includeUrl ? { url: subscription.url } : {})
  };
}

async function importSubscription(input = {}) {
  const state = await getState();
  let url;
  try {
    url = new URL(String(input.url || ""));
  } catch {
    throw new Error("Введите корректную HTTPS-ссылку подписки");
  }
  if (url.protocol !== "https:") throw new Error("Подписка должна использовать HTTPS");
  const response = await fetch(url.href, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Подписка ответила HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length")) || 0;
  if (length > 2_000_000) throw new Error("Подписка больше 2 МБ");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Подписка больше 2 МБ");
  const parsed = parseSubscription(text);
  if (!parsed.nodes.length) throw new Error("В подписке не найдено поддерживаемых форматов");

  const existing = state.subscriptions.find((item) => item.id === input.id);
  const id = existing?.id || crypto.randomUUID();
  const oldServers = state.servers.filter((server) => server.subscriptionId === id);
  const oldIdsByKey = new Map(oldServers.map((server) => [server.sourceNodeKey, server.id]));
  const importedServers = parsed.nodes
    .map((node) => subscriptionNodeToServer(node, id, oldIdsByKey.get(node.key) || crypto.randomUUID()))
    .filter(Boolean)
    .map(normalizeServer);
  let servers = [
    ...state.servers.filter((server) => server.subscriptionId !== id),
    ...importedServers
  ];
  if (!servers.length) servers = [normalizeServer(DEFAULT_SERVER)];

  const activeStillExists = servers.some((server) => server.id === state.activeServerId);
  const activeServerId = activeStillExists
    ? state.activeServerId
    : importedServers[0]?.id || servers[0].id;
  const subscription = normalizeSubscription({
    id,
    name: String(input.name || existing?.name || url.hostname).trim(),
    url: url.href,
    origin: url.origin,
    updatedAt: new Date().toISOString(),
    nodeCount: parsed.nodes.length,
    compatibleCount: parsed.compatibleCount,
    companionCount: parsed.companionCount,
    protocols: parsed.protocols,
    nodes: parsed.nodes.map((node) => ({
      name: node.name,
      protocol: node.protocol,
      protocolLabel: node.protocolLabel,
      host: node.host,
      port: node.port,
      compatible: node.compatible,
      requiresCompanion: node.requiresCompanion
    })),
    lastError: null
  });
  const subscriptions = existing
    ? state.subscriptions.map((item) => item.id === id ? subscription : item)
    : [...state.subscriptions, subscription];
  const activeServer = servers.find((server) => server.id === activeServerId) || servers[0];
  const next = await saveState({
    ...state,
    servers,
    subscriptions,
    activeServerId: activeServer.id,
    configured: isServerConfigured(activeServer),
    lastError: null
  });
  await applyProxy(next);
  return getPublicStatus(null, next, true);
}

async function refreshSubscription(id) {
  const state = await getState();
  const subscription = state.subscriptions.find((item) => item.id === id);
  if (!subscription) throw new Error("Подписка не найдена");
  return importSubscription({ id, name: subscription.name, url: subscription.url });
}

async function deleteSubscription(id) {
  const state = await getState();
  let servers = state.servers.filter((server) => server.subscriptionId !== id);
  if (!servers.length) servers = [normalizeServer(DEFAULT_SERVER)];
  const subscriptions = state.subscriptions.filter((item) => item.id !== id);
  const activeServer = servers.some((server) => server.id === state.activeServerId)
    ? servers.find((server) => server.id === state.activeServerId)
    : servers[0];
  const next = await saveState({
    ...state,
    servers,
    subscriptions,
    activeServerId: activeServer.id,
    configured: isServerConfigured(activeServer),
    lastError: null
  });
  await applyProxy(next);
  return getPublicStatus(null, next, true);
}

function getPublicStatus(host, state, includeCredentials = false, includeDomains = false) {
  const domains = effectiveDomains(state);
  const source = host ? routeSource(host, state) : "direct";
  const activeServer = getActiveServer(state);
  const configured = isServerConfigured(activeServer);
  const exposeServer = (server) => includeCredentials
    ? {
        ...server,
        protocolLabel: protocolLabel(server.protocol || server.scheme),
        flag: countryFlag(server.countryCode)
      }
    : {
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        scheme: server.scheme,
        protocol: server.protocol,
        protocolLabel: protocolLabel(server.protocol || server.scheme),
        username: server.username,
        hasPassword: Boolean(server.password),
        source: server.source,
        subscriptionId: server.subscriptionId,
        countryCode: server.countryCode,
        countryName: server.countryName,
        flag: countryFlag(server.countryCode),
        exitIp: server.exitIp
      };
  return {
    enabled: state.enabled,
    configured,
    routeMode: state.routeMode,
    useCommunityList: state.useCommunityList,
    communityCount: state.communityDomains.length,
    communitySources: state.communitySources,
    communityUpdatedAt: state.communityUpdatedAt,
    customDomains: state.customDomains,
    bypassDomains: state.bypassDomains,
    activeCount: domains.length,
    domainEntries: includeDomains
      ? domains.map((domain) => ({ domain, source: routeSource(domain, { ...state, routeMode: "selected" }) }))
      : undefined,
    currentDomain: host ?? null,
    currentRouted: host ? source !== "direct" : false,
    currentSource: source,
    activeServerId: activeServer.id,
    activeServer: exposeServer(activeServer),
    servers: state.servers.map(exposeServer),
    subscriptions: state.subscriptions.map((subscription) =>
      subscriptionSummary(subscription, includeCredentials)
    ),
    supportedProxySchemes: Object.entries(DIRECT_PROXY_SCHEMES).map(([id, item]) => ({
      id,
      label: item.label
    })),
    proxy: exposeServer(activeServer),
    updateNotice: publicUpdateNotice(state),
    lastError: state.lastError
  };
}

async function handleMessage(message) {
  const state = await getState();
  switch (message?.type) {
    case "getStatus":
      return getPublicStatus(
        normalizeDomain(message.host),
        state,
        Boolean(message.includeCredentials),
        Boolean(message.includeDomains)
      );
    case "getUpdateNotice":
      return publicUpdateNotice(state);
    case "dismissUpdateNotice":
      return dismissUpdateNotice();
    case "checkForUpdate":
      return checkForExtensionUpdate();
    case "setEnabled": {
      const next = await saveState({ ...state, enabled: Boolean(message.enabled) });
      await applyProxy(next);
      return getPublicStatus(normalizeDomain(message.host), next);
    }
    case "setRouteMode": {
      const routeMode = message.routeMode === "all" ? "all" : "selected";
      const next = await saveState({ ...state, routeMode });
      await applyProxy(next);
      return getPublicStatus(normalizeDomain(message.host), next);
    }
    case "toggleDomain":
      return toggleDomain(message.host);
    case "setCommunityList": {
      const next = await saveState({ ...state, useCommunityList: Boolean(message.enabled) });
      await applyProxy(next);
      return getPublicStatus(null, next);
    }
    case "updateCommunityList":
      return updateCommunityList();
    case "saveProxy":
      return saveServer({ ...(message.proxy ?? {}), id: state.activeServerId });
    case "saveServer":
      return saveServer(message.server ?? {});
    case "selectServer":
      return selectServer(String(message.id ?? ""));
    case "deleteServer":
      return deleteServer(String(message.id ?? ""));
    case "importSubscription":
      return importSubscription(message.subscription ?? {});
    case "refreshSubscription":
      return refreshSubscription(String(message.id ?? ""));
    case "deleteSubscription":
      return deleteSubscription(String(message.id ?? ""));
    case "testProxy":
      return testProxy();
    case "probeLocation": {
      const next = await probeActiveServerLocation(state);
      return getPublicStatus(normalizeDomain(message.host), next);
    }
    case "addDomain":
    {
      const domain = normalizeDomain(message.host);
      if (!domain) throw new Error("Введите домен, например example.com");
      const next = await saveState({
        ...state,
        customDomains: [...new Set([...state.customDomains, domain])],
        bypassDomains: state.bypassDomains.filter((item) => !domainMatches(domain, item))
      });
      await applyProxy(next);
      return getPublicStatus(domain, next);
    }
    case "removeCustomDomain": {
      const domain = normalizeDomain(message.host);
      const next = await saveState({
        ...state,
        customDomains: state.customDomains.filter((item) => item !== domain)
      });
      await applyProxy(next);
      return getPublicStatus(null, next);
    }
    case "removeBypassDomain": {
      const domain = normalizeDomain(message.host);
      const next = await saveState({
        ...state,
        bypassDomains: state.bypassDomains.filter((item) => item !== domain)
      });
      await applyProxy(next);
      return getPublicStatus(null, next);
    }
    default:
      throw new Error("Неизвестная команда");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    getState()
      .then((state) => {
        if (!details.isProxy) return callback();
        const server = getActiveServer(state);
        const challenger = details.challenger?.host?.toLowerCase();
        if (challenger && challenger !== server.host.toLowerCase()) return callback();
        if (!isServerConfigured(server)) return callback({ cancel: true });
        if (!server.username || !server.password) return callback();
        const attempts = proxyAuthAttempts.get(details.requestId) ?? 0;
        if (attempts >= 2) return callback({ cancel: true });
        proxyAuthAttempts.set(details.requestId, attempts + 1);
        callback({
          authCredentials: {
            username: server.username,
            password: server.password
          }
        });
      })
      .catch(() => callback({ cancel: true }));
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

const clearAuthAttempt = (details) => proxyAuthAttempts.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(clearAuthAttempt, { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener(clearAuthAttempt, { urls: ["<all_urls>"] });

chrome.proxy.onProxyError.addListener(async (details) => {
  const state = await getState();
  await saveState({ ...state, lastError: details.error || details.details || "Ошибка прокси" });
});

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await initialize();
  if (reason === "install") await chrome.runtime.openOptionsPage();
  if (reason === "update") await setInstalledUpdateNotice(previousVersion);
});

chrome.runtime.onStartup.addListener(initialize);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-community-list") updateCommunityList().catch(() => {});
  if (alarm.name === "check-extension-update") checkForExtensionUpdate().catch(() => {});
});

initialize().catch(async (error) => {
  const state = await getState();
  await saveState({ ...state, lastError: error.message });
});
