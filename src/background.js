import {
  COMMUNITY_LIST_URL,
  CORE_DOMAINS,
  domainMatches,
  effectiveDomains,
  generatePac,
  normalizeDomain,
  parseDomainList,
  routeSource
} from "../lib/rules.js";

const DEFAULT_SERVER = Object.freeze({
  id: "server-1",
  name: "Основной сервер",
  host: "ton4.pro",
  port: 18443,
  username: "amnezia-browser",
  password: ""
});

const DEFAULT_STATE = Object.freeze({
  enabled: true,
  configured: false,
  useCommunityList: true,
  communityDomains: [],
  communityUpdatedAt: null,
  customDomains: [],
  bypassDomains: [],
  activeServerId: DEFAULT_SERVER.id,
  servers: [DEFAULT_SERVER],
  lastError: null
});

let stateCache = null;
const proxyAuthAttempts = new Map();

function normalizeServer(server = {}, fallbackId = "server-1", fallbackName = "Сервер") {
  return {
    id: String(server.id || fallbackId),
    name: String(server.name || fallbackName).trim() || fallbackName,
    host: String(server.host || "").trim().toLowerCase(),
    port: Number(server.port) || 0,
    username: String(server.username || "").trim(),
    password: String(server.password || "")
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
    servers,
    activeServerId,
    communityDomains: [...(saved.communityDomains ?? [])],
    customDomains: [...(saved.customDomains ?? [])],
    bypassDomains: [...(saved.bypassDomains ?? [])]
  };
}

function getActiveServer(state) {
  return state.servers.find((server) => server.id === state.activeServerId) ?? state.servers[0];
}

function isServerConfigured(server) {
  return Boolean(
    server?.host && Number(server.port) > 0 && server.username && server.password
  );
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
      communityUpdatedAt: "2026-07-15T00:00:00.000Z"
    });
  }
  await chrome.alarms.create("refresh-community-list", { periodInMinutes: 24 * 60 });
  await applyProxy(state);
  return state;
}

async function setBadge(state) {
  const active = state.enabled && isServerConfigured(getActiveServer(state));
  await chrome.action.setBadgeText({ text: active ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: active ? "#14A27A" : "#8A93A3" });
  await chrome.action.setTitle({
    title: active ? "Amnezia Split включён" : "Amnezia Split выключен"
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

  const domains = effectiveDomains(state);
  const pac = generatePac({
    domains,
    bypassDomains: state.bypassDomains,
    proxyHost: server.host,
    proxyPort: server.port
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
  const response = await fetch(`${COMMUNITY_LIST_URL}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Источник списка ответил ${response.status}`);
  const domains = parseDomainList(await response.text());
  if (domains.length < 500) throw new Error("Получен подозрительно короткий список");

  const state = await getState();
  const next = await saveState({
    ...state,
    communityDomains: domains,
    communityUpdatedAt: new Date().toISOString(),
    lastError: null
  });
  await applyProxy(next);
  return { count: domains.length, updatedAt: next.communityUpdatedAt };
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
  if (!name) throw new Error("Введите название сервера");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Проверьте адрес сервера и порт");
  }
  if (!username || !password) throw new Error("Введите логин и пароль");

  const server = { id, name, host, port, username, password };
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
  return getPublicStatus(null, next, true);
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

async function testProxy() {
  const state = await getState();
  const server = getActiveServer(state);
  if (!isServerConfigured(server)) throw new Error("Сначала сохраните данные подключения");
  try {
    await chrome.proxy.settings.clear({ scope: "regular" });
    const directResponse = await fetch(`https://api.ipify.org?format=json&direct=${Date.now()}`, {
      cache: "no-store"
    });
    if (!directResponse.ok) throw new Error("Не удалось проверить обычное подключение");
    const direct = await directResponse.json();

    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "https",
            host: server.host,
            port: Number(server.port)
          }
        }
      },
      scope: "regular"
    });
    const response = await fetch(`https://api.ipify.org?format=json&proxy=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Прокси ответил ${response.status}`);
    const proxied = await response.json();
    return { directIp: direct.ip, proxyIp: proxied.ip };
  } finally {
    await applyProxy(state);
  }
}

function getPublicStatus(host, state, includeCredentials = false) {
  const domains = effectiveDomains(state);
  const source = host ? routeSource(host, state) : "direct";
  const activeServer = getActiveServer(state);
  const configured = isServerConfigured(activeServer);
  const exposeServer = (server) => includeCredentials
    ? { ...server }
    : {
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        hasPassword: Boolean(server.password)
      };
  return {
    enabled: state.enabled,
    configured,
    useCommunityList: state.useCommunityList,
    communityCount: state.communityDomains.length,
    communityUpdatedAt: state.communityUpdatedAt,
    customDomains: state.customDomains,
    bypassDomains: state.bypassDomains,
    activeCount: domains.length,
    currentDomain: host ?? null,
    currentRouted: host ? source !== "direct" : false,
    currentSource: source,
    activeServerId: activeServer.id,
    activeServer: exposeServer(activeServer),
    servers: state.servers.map(exposeServer),
    proxy: exposeServer(activeServer),
    lastError: state.lastError
  };
}

async function handleMessage(message) {
  const state = await getState();
  switch (message?.type) {
    case "getStatus":
      return getPublicStatus(normalizeDomain(message.host), state, Boolean(message.includeCredentials));
    case "setEnabled": {
      const next = await saveState({ ...state, enabled: Boolean(message.enabled) });
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
    case "testProxy":
      return testProxy();
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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await initialize();
  if (reason === "install") await chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(initialize);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-community-list") updateCommunityList().catch(() => {});
});

initialize().catch(async (error) => {
  const state = await getState();
  await saveState({ ...state, lastError: error.message });
});
