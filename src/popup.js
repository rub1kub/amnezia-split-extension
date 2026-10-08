import { normalizeLatency, isLatencyFresh, latencyLabel, latencyTone, sortByLatency } from "../lib/latency.js";

const $ = (selector) => document.querySelector(selector);
const PREVIEW_PARAMS = new URLSearchParams(location.search);
const PREVIEW = PREVIEW_PARAMS.has("preview");
const PREVIEW_MANY = PREVIEW_PARAMS.has("many");
const PREVIEW_AUTO_NEXT = PREVIEW_PARAMS.has("autonext");
const PREVIEW_SEARCH = PREVIEW_PARAMS.get("search") || "";

const PREVIEW_STATUS = {
  enabled: true,
  configured: true,
  routeMode: "selected",
  useCommunityList: true,
  communityCount: 1687,
  activeCount: 1692,
  currentRouted: true,
  activeServerId: "server-1",
  servers: [
    { id: "server-1", name: "Основной сервер", protocolLabel: "HTTPS", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.10" },
    { id: "gateway-node-1", name: "🇩🇪 Германия · Hysteria 2", protocolLabel: "Hysteria 2", countryCode: "DE", countryName: "Германия", flag: "🇩🇪", exitIp: "198.51.100.25", source: "gateway" }
  ],
  activeServer: { id: "server-1", name: "Основной сервер", protocolLabel: "HTTPS", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.10" },
  subscriptionCards: [],
  updateNotice: {
    kind: "installed",
    version: "0.9.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.9.0"
  }
};

if (PREVIEW_MANY) {
  const countryCodes = ["HK", "DE", "NL", "SE", "US", "JP"];
  PREVIEW_STATUS.servers = Array.from({ length: 286 }, (_, index) => {
    const code = countryCodes[index % countryCodes.length];
    return {
      id: `gateway-node-${index + 1}`,
      name: index === 0 ? "HK ⭐ Гонконг" : `${code} · Сервер ${index + 1}`,
      protocolLabel: index % 3 === 0 ? "VLESS" : "Hysteria 2",
      declaredCountryCode: code,
      countryCode: index === 0 ? "NL" : code,
      countryName: index === 0 ? "Нидерланды" : new Intl.DisplayNames(["ru"], { type: "region" }).of(code),
      flag: "",
      exitIp: index === 0 ? "89.105.206.149" : "203.0.113.10",
      source: "gateway",
      subscriptionId: index % 2 ? "sub-b" : "sub-a",
      subscriptionName: index % 2 ? "Резервная подписка" : "Основная подписка"
    };
  });
  PREVIEW_STATUS.activeServerId = PREVIEW_STATUS.servers[0].id;
  PREVIEW_STATUS.activeServer = PREVIEW_STATUS.servers[0];
  PREVIEW_STATUS.activeCount = 1687;
  PREVIEW_STATUS.updateNotice = null;
}

let currentHost = "";
let currentStatus = null;
let currentDeckItems = [];
let currentDeckIndex = 0;
let navigationBusy = false;
let swipeStartX = null;
let locationProbeServerId = null;
let listOpen = false;
let batch = null;
const latencies = new Map();
const pingBusy = new Set();
const regionNames = typeof Intl.DisplayNames === "function"
  ? new Intl.DisplayNames(["ru"], { type: "region" })
  : null;

async function send(type, payload = {}) {
  if (PREVIEW) {
    if (type === "getServerLatencies") return Object.fromEntries(latencies);
    if (type === "pingServer") {
      // Demo data is restricted to the explicit preview, never used by the extension.
      await new Promise((resolve) => setTimeout(resolve, 120));
      const index = PREVIEW_STATUS.servers.findIndex((item) => item.id === payload.id);
      return { id: payload.id, latency: normalizeLatency({ status: "ok", delayMs: 42 + index % 11 * 29, checkedAt: new Date().toISOString() }) };
    }
    if (type === "setEnabled") PREVIEW_STATUS.enabled = payload.enabled;
    if (type === "toggleDomain") PREVIEW_STATUS.currentRouted = !PREVIEW_STATUS.currentRouted;
    if (type === "setCommunityList") PREVIEW_STATUS.useCommunityList = payload.enabled;
    if (type === "setRouteMode") PREVIEW_STATUS.routeMode = payload.routeMode;
    if (type === "selectServer") {
      PREVIEW_STATUS.activeServerId = payload.id;
      PREVIEW_STATUS.activeServer = PREVIEW_STATUS.servers.find((item) => item.id === payload.id) || PREVIEW_STATUS.activeServer;
    }
    if (type === "probeLocation") return { ...PREVIEW_STATUS };
    if (type === "dismissUpdateNotice") PREVIEW_STATUS.updateNotice = null;
    return { ...PREVIEW_STATUS };
  }
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Расширение не ответило");
  return response.data;
}

function setSwitch(element, checked) {
  element.setAttribute("aria-checked", String(Boolean(checked)));
}

function showNotice(text, kind = "info") {
  const notice = $("#notice");
  notice.textContent = text;
  notice.className = `notice ${kind}`;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add("hidden"), 2800);
}

function renderUpdateNotice(notice) {
  const card = $("#updateCard");
  card.classList.toggle("hidden", !notice);
  if (!notice) return;
  $("#updateText").textContent = notice.kind === "installed"
    ? `Обновлено до ${notice.version}`
    : `Доступна версия ${notice.version}`;
  $("#updateLink").href = notice.url;
}

function makeElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function requireStatus() {
  if (currentStatus) return true;
  showNotice("Routeva ещё запускается — подождите секунду", "info");
  return false;
}

function protocolLabel(protocol) {
  return {
    vless: "VLESS",
    vmess: "VMess",
    trojan: "Trojan",
    ss: "Shadowsocks",
    hysteria2: "Hysteria 2",
    tuic: "TUIC",
    wireguard: "WireGuard",
    amneziawg: "AmneziaWG"
  }[protocol] || String(protocol || "").toUpperCase();
}

function countryNameByCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

function searchableServerText(server) {
  return [
    server.name,
    server.protocolLabel,
    server.protocol,
    server.countryName,
    countryNameByCode(server.declaredCountryCode),
    server.declaredCountryCode,
    server.countryCode
  ].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
}

function openSubscriptionSetup(subscriptionId) {
  const target = `options.html?connect=${encodeURIComponent(subscriptionId)}`;
  if (PREVIEW) {
    location.href = `${target}&preview=1`;
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/${target}`) });
  window.close();
}

function activeCopy(status) {
  const active = status.enabled && status.configured;
  const modeCopy = status.routeMode === "all" ? "Весь интернет через VPN" : "Только выбранные сайты";
  return {
    active,
    eyebrow: status.configured ? (active ? "ЗАЩИТА АКТИВНА" : "НА ПАУЗЕ") : "НУЖНА НАСТРОЙКА",
    title: status.configured ? (active ? "VPN включён" : "VPN выключен") : "Настройте сервер",
    text: status.configured
      ? (active ? modeCopy : "Все сайты подключаются напрямую")
      : "Откройте настройки"
  };
}

function createServerSlide(server, status) {
  const copy = activeCopy(status);
  const slide = makeElement("article", `status-card server-slide${copy.active ? "" : " is-off"}`);
  slide.dataset.serverId = server.id;
  const actualCountryCode = String(server.countryCode || "").toLowerCase();
  const declaredCountryCode = String(server.declaredCountryCode || "").toLowerCase();
  const visualCountryCode = declaredCountryCode || actualCountryCode;
  if (/^[a-z]{2}$/.test(visualCountryCode)) {
    slide.classList.add("has-country-backdrop");
    const backdrop = makeElement("img", "country-backdrop");
    backdrop.src = new URL(`../assets/flags/${visualCountryCode}.svg`, location.href).href;
    backdrop.alt = "";
    backdrop.setAttribute("aria-hidden", "true");
    slide.append(backdrop);
  }
  const top = makeElement("div", "server-slide-top");
  const protocol = makeElement("span", "protocol-pill", server.protocolLabel || String(server.scheme || "HTTPS").toUpperCase());
  const isActive = server.id === status.activeServerId;
  const pendingLocation = isActive && !server.countryName;
  top.append(protocol);

  const copyWrap = makeElement("div", "status-copy");
  copyWrap.append(
    makeElement("span", "eyebrow", copy.eyebrow),
    makeElement("h1", "", copy.title),
    makeElement("p", "", copy.text)
  );
  const serverInfo = makeElement("div", "server-slide-info");
  const serverName = makeElement("strong", "", server.name || "Без названия");
  const declaredCountryName = countryNameByCode(server.declaredCountryCode);
  const visibleCountryName = declaredCountryName || server.countryName;
  const nameAlreadyHasCountry = visibleCountryName
    && String(server.name || "").toLocaleLowerCase("ru-RU").includes(visibleCountryName.toLocaleLowerCase("ru-RU"));
  const locationText = makeElement(
    "span",
    "",
    visibleCountryName
      ? (server.exitIp
          ? `${nameAlreadyHasCountry ? "" : `${visibleCountryName} · `}${server.exitIp}`
          : (nameAlreadyHasCountry ? "Страна указана в названии" : visibleCountryName))
      : pendingLocation ? "Определяем фактический выход…" : "Выход определится при выборе"
  );
  serverInfo.append(serverName, locationText);
  const count = makeElement("div", "route-count");
  count.append(
    makeElement("strong", "", status.routeMode === "all" ? "Весь интернет" : status.activeCount.toLocaleString("ru-RU")),
    makeElement("span", "", status.routeMode === "all" ? "через VPN" : "доменов через VPN")
  );
  slide.append(top, copyWrap, serverInfo, count);
  return slide;
}

function createSubscriptionSlide(subscription) {
  const slide = makeElement("article", "status-card server-slide subscription-slide");
  slide.dataset.subscriptionId = subscription.subscriptionId;
  const copyWrap = makeElement("div", "status-copy");
  copyWrap.append(
    makeElement("span", "eyebrow", "ПОДПИСКА ДОБАВЛЕНА"),
    makeElement("h1", "", subscription.name),
    makeElement("p", "", `${Number(subscription.nodeCount || 0).toLocaleString("ru-RU")} серверов в этой подписке`)
  );
  const protocols = makeElement("div", "subscription-slide-protocols");
  (subscription.protocols || []).slice(0, 3).forEach((protocol) => {
    protocols.append(makeElement("span", "", protocolLabel(protocol)));
  });
  const button = makeElement("button", "subscription-slide-action", "Открыть подписку →");
  button.type = "button";
  button.addEventListener("click", () => openSubscriptionSetup(subscription.subscriptionId));
  slide.append(copyWrap, protocols, button);
  return slide;
}

function createDeckSlide(item, status) {
  return item.kind === "subscription"
    ? createSubscriptionSlide(item)
    : createServerSlide(item, status);
}

function updateCarouselMeta(index) {
  const total = Math.max(1, currentDeckItems.length);
  $("#serverPosition").textContent = `${index + 1} из ${total}`;
  $("#serverPrev").disabled = navigationBusy || index <= 0 || total <= 1;
  $("#serverNext").disabled = navigationBusy || index >= total - 1 || total <= 1;
  const showingSubscription = currentDeckItems[index]?.kind === "subscription";
  $("#masterToggle").classList.toggle("hidden", showingSubscription);
  $("#serverDeck").classList.toggle("showing-subscription", showingSubscription);
  $("#serverDeck").setAttribute("aria-label", currentDeckItems[index]?.name
    ? `Сервер ${index + 1} из ${total}: ${currentDeckItems[index].name}`
    : `Сервер ${index + 1} из ${total}`);
}

function renderDeckIndex(status, index) {
  const track = $("#serverTrack");
  currentDeckIndex = Math.min(Math.max(0, index), Math.max(0, currentDeckItems.length - 1));
  const item = currentDeckItems[currentDeckIndex];
  track.replaceChildren(item ? createDeckSlide(item, status) : createServerSlide(status.activeServer || {}, status));
  updateCarouselMeta(currentDeckIndex);
}

function renderServerDeck(status) {
  const servers = Array.isArray(status.servers) ? status.servers : [];
  const fallbackServer = status.activeServer?.id
    ? [{ ...status.activeServer, kind: "server", selectable: true }]
    : [];
  currentDeckItems = [
    ...(servers.length ? servers.map((server) => ({ ...server, kind: "server", selectable: true })) : fallbackServer),
    ...(Array.isArray(status.subscriptionCards) ? status.subscriptionCards : [])
  ];
  const activeIndex = Math.max(0, currentDeckItems.findIndex((server) => server.id === status.activeServerId));
  renderDeckIndex(status, activeIndex);
  renderServerSearch();
}

function normalizeRenderableStatus(status = {}) {
  const servers = Array.isArray(status.servers) ? status.servers : [];
  const activeServer = status.activeServer
    || servers.find((server) => server.id === status.activeServerId)
    || servers[0]
    || { id: "unavailable", name: "Серверы загружаются", protocolLabel: "VPN" };
  return {
    ...status,
    enabled: status.enabled !== false,
    configured: Boolean(status.configured),
    routeMode: status.routeMode === "all" ? "all" : "selected",
    useCommunityList: status.useCommunityList !== false,
    communityCount: Number(status.communityCount || 0),
    activeCount: Number(status.activeCount || 0),
    servers,
    activeServer,
    activeServerId: status.activeServerId || activeServer.id,
    subscriptionCards: Array.isArray(status.subscriptionCards) ? status.subscriptionCards : []
  };
}

async function selectDeckIndex(nextIndex) {
  if (!requireStatus() || navigationBusy) return;
  nextIndex = Math.min(Math.max(0, nextIndex), currentDeckItems.length - 1);
  if (nextIndex === currentDeckIndex) return;
  const item = currentDeckItems[nextIndex];
  if (!item || item.kind !== "server") {
    renderDeckIndex(currentStatus, nextIndex);
    return;
  }
  if (item.id === currentStatus.activeServerId) {
    renderDeckIndex(currentStatus, nextIndex);
    return;
  }
  navigationBusy = true;
  const previousStatus = currentStatus;
  const previousIndex = currentDeckIndex;
  const optimisticStatus = {
    ...currentStatus,
    activeServerId: item.id,
    activeServer: item
  };
  currentStatus = optimisticStatus;
  renderDeckIndex(optimisticStatus, nextIndex);
  $("#serverDeck").setAttribute("aria-busy", "true");
  updateCarouselMeta(currentDeckIndex);
  try {
    const next = await send("selectServer", { id: item.id });
    render(next);
    probeLocationInBackground(item.id);
  } catch (error) {
    currentStatus = previousStatus;
    renderDeckIndex(previousStatus, previousIndex);
    showNotice(error.message, "error");
  } finally {
    navigationBusy = false;
    $("#serverDeck").removeAttribute("aria-busy");
    updateCarouselMeta(currentDeckIndex);
    updateListSelection();
  }
}

function navigateDeck(step) {
  return selectDeckIndex(currentDeckIndex + step);
}

function closeServerSearch({ clear = false } = {}) {
  if (clear) $("#serverSearchInput").value = "";
  $("#serverSearchClear").classList.toggle("hidden", !$("#serverSearchInput").value);
  renderServerSearch();
}

function filteredServers() {
  const query = $("#serverSearchInput").value.trim().toLocaleLowerCase("ru-RU");
  const filter = $("#serverFilter").value;
  let items = currentDeckItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "server" && searchableServerText(item).includes(query)
      && (filter === "all" || (filter === "manual" ? item.source !== "gateway" : item.subscriptionId === filter)))
    .map((entry) => ({ ...entry, latency: latencies.get(entry.item.id) }));
  if ($("#serverSort").value === "latency") items = sortByLatency(items);
  if ($("#serverSort").value === "name") items.sort((a, b) => (a.item.name || "").localeCompare(b.item.name || "", "ru"));
  return items;
}

function populateServerFilter() {
  const select = $("#serverFilter");
  const previous = select.value;
  const subscriptions = new Map();
  for (const server of currentStatus?.servers || []) {
    if (server.subscriptionId) subscriptions.set(server.subscriptionId, server.subscriptionName || "Подписка");
  }
  select.replaceChildren(new Option("Все серверы", "all"), new Option("Ручные прокси", "manual"));
  for (const [id, name] of subscriptions) select.append(new Option(name, id));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function latencyTitle(server, latency) {
  if (server.source !== "gateway") return "Пинг доступен для узлов подписки на Routeva Gateway. Ручной прокси не переключается ради теста.";
  const at = latency?.checkedAt ? new Date(latency.checkedAt).toLocaleTimeString("ru-RU") : "ещё не проверялся";
  const stale = latency && !isLatencyFresh(latency) ? "; устарело — перепроверьте" : "";
  const detail = { busy: "Gateway занят", "core-unavailable": "Mihomo недоступен", "invalid-response": "Некорректный ответ", "gateway-update": "Обновите Gateway до 0.9.0", "api-error": "Не удалось связаться с Gateway" }[latency?.code];
  return `HTTPS через Gateway → выбранный узел → gstatic.com; ${at}${stale}${detail ? `; ${detail}` : ""}. Нажмите для проверки.`;
}

function updateLatencyButton(button, server) {
  const latency = latencies.get(server.id);
  button.textContent = pingBusy.has(server.id) ? "…" : latencyLabel(latency);
  button.className = `server-latency tone-${latencyTone(latency)}${latency && !isLatencyFresh(latency) ? " is-stale" : ""}`;
  button.dataset.pingable = String(server.source === "gateway");
  button.disabled = Boolean(batch) || pingBusy.size >= 3 || pingBusy.has(server.id) || server.source !== "gateway";
  button.title = latencyTitle(server, latency);
  button.setAttribute("aria-label", `Проверить пинг: ${server.name || "Сервер"}. ${latencyLabel(latency)}`);
}

function updateListSelection() {
  for (const row of $("#serverSearchResults").children) {
    const selected = row.dataset.serverId === currentStatus?.activeServerId;
    row.classList.toggle("is-selected", selected);
    const button = row.querySelector(".server-choice");
    if (button) {
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = navigationBusy;
    }
  }
}

function updatePingRow(server) {
  const list = $("#serverSearchResults");
  const row = [...list.children].find((element) => element.dataset.serverId === server.id);
  const button = row?.querySelector(".server-latency");
  if (button) updateLatencyButton(button, server);
  updatePingAvailability();
  if ($("#serverSort").value !== "latency" || batch) return;
  // Reuse rows rather than rebuilding hundreds of flag images for each result.
  const rows = new Map([...list.children].map((element) => [element.dataset.serverId, element]));
  const focused = document.activeElement;
  const scroll = list.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const { item } of filteredServers()) {
    if (rows.has(item.id)) fragment.append(rows.get(item.id));
  }
  list.append(fragment);
  if (focused && list.contains(focused)) focused.focus({ preventScroll: true });
  list.scrollTop = scroll;
}

function updatePingAvailability() {
  for (const row of $("#serverSearchResults").children) {
    const button = row.querySelector(".server-latency");
    if (button) button.disabled = button.dataset.pingable !== "true" || Boolean(batch)
      || pingBusy.size >= 3 || pingBusy.has(row.dataset.serverId);
  }
  updatePingControls();
}

function renderServerSearch() {
  const results = $("#serverSearchResults");
  const focusedId = document.activeElement?.closest(".server-row")?.dataset.serverId;
  const focusedClass = document.activeElement?.className.includes("server-latency") ? ".server-latency" : ".server-choice";
  const oldScroll = results.scrollTop;
  const matches = filteredServers();
  $("#serverSearchClear").classList.toggle("hidden", !$("#serverSearchInput").value);
  $("#filteredServerCount").textContent = String(matches.length);
  $("#serverListCount").textContent = String(currentStatus?.servers?.length || 0);
  results.replaceChildren();
  if (!matches.length) {
    results.append(makeElement("p", "server-search-empty", "Ничего не найдено"));
  } else {
    matches.forEach(({ item, index }) => {
      const row = makeElement("div", "server-row");
      row.dataset.serverId = item.id;
      const button = makeElement("button", "server-choice");
      button.type = "button";
      const code = String(item.declaredCountryCode || item.countryCode || "").toLowerCase();
      const flag = /^[a-z]{2}$/.test(code) ? makeElement("img", "server-flag") : makeElement("span", "server-flag", "◎");
      if (flag.tagName === "IMG") {
        flag.src = new URL(`../assets/flags/${code}.svg`, location.href).href;
        flag.alt = "";
        flag.addEventListener("error", () => flag.replaceWith(makeElement("span", "server-flag", "◎")), { once: true });
      }
      const copy = makeElement("span", "server-row-copy");
      copy.append(
        makeElement("strong", "", item.name || "Без названия"),
        makeElement("small", "", `${item.protocolLabel || protocolLabel(item.protocol) || "Прокси"} · ${item.subscriptionName || (item.source === "gateway" ? "Gateway" : "Ручной прокси")}`)
      );
      button.append(flag, copy);
      button.addEventListener("click", async () => {
        await selectDeckIndex(index);
      });
      const ping = makeElement("button", "server-latency");
      ping.type = "button";
      updateLatencyButton(ping, item);
      ping.addEventListener("click", () => pingOne(item));
      row.append(button, ping);
      results.append(row);
    });
  }
  updateListSelection();
  if (focusedId) {
    const row = [...results.children].find((element) => element.dataset.serverId === focusedId);
    row?.querySelector(focusedClass)?.focus({ preventScroll: true });
  }
  results.scrollTop = oldScroll;
  updatePingControls();
}

function updatePingControls() {
  $("#pingAll").textContent = batch && !batch.cancelled ? "Стоп" : "Пинг всех";
  $("#pingAll").disabled = Boolean(batch?.cancelled) || (!batch && (pingBusy.size >= 3 || !filteredServers().some(({ item }) => item.source === "gateway")));
  $("#pingProgress").textContent = batch ? `${batch.done}/${batch.total}${batch.cancelled ? " · остановка" : ""}` : "";
}

async function pingOne(server, quiet = false) {
  if (pingBusy.has(server.id) || server.source !== "gateway" || pingBusy.size >= 3 || (batch && !quiet)) return;
  pingBusy.add(server.id);
  updatePingRow(server);
  try {
    const result = await send("pingServer", { id: server.id });
    if (result.id !== server.id || !normalizeLatency(result.latency)) throw new Error("Некорректный ответ Gateway");
    latencies.set(server.id, normalizeLatency(result.latency));
  } catch (error) {
    const needsUpdate = /0\.9\.0/.test(error.message);
    latencies.set(server.id, normalizeLatency({ status: "error", checkedAt: new Date().toISOString(), code: needsUpdate ? "gateway-update" : "api-error" }));
    if (batch && needsUpdate) batch.cancelled = true;
    if (!quiet || needsUpdate) showNotice(error.message, "error");
  } finally {
    pingBusy.delete(server.id);
    updatePingRow(server);
  }
}

async function pingAll({ staleOnly = false } = {}) {
  if (batch) {
    batch.cancelled = true;
    updatePingControls();
    return;
  }
  const queue = filteredServers().map(({ item }) => item).filter((item) => item.source === "gateway"
    && !pingBusy.has(item.id) && (!staleOnly || !isLatencyFresh(latencies.get(item.id))));
  if (!queue.length) return;
  const availableSlots = 3 - pingBusy.size;
  if (availableSlots <= 0) return;
  const run = { cancelled: false, total: queue.length, done: 0 };
  batch = run;
  updatePingAvailability();
  const worker = async () => {
    while (!run.cancelled && listOpen && queue.length) {
      const server = queue.shift();
      await pingOne(server, true);
      run.done++;
      updatePingControls();
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableSlots, queue.length) }, worker));
  if (batch === run) batch = null;
  renderServerSearch();
  updatePingControls();
  if (listOpen) showNotice(run.cancelled ? "Очередь остановлена. Уже начатые проверки завершены." : `Проверено серверов: ${run.done}`, "info");
}

function setListOpen(open) {
  listOpen = open;
  $("#mainView").classList.toggle("hidden", open);
  $("#serversView").classList.toggle("hidden", !open);
  $("#updateCard").classList.toggle("hidden", open || !currentStatus?.updateNotice);
  if (open) {
    renderServerSearch();
    $("#serverSearchInput").focus();
    if ($("#autoPing").checked) pingAll({ staleOnly: true });
  } else {
    if (batch) batch.cancelled = true;
    $("#openServerList").focus();
  }
}

async function saveListPreferences() {
  if (!PREVIEW) await chrome.storage.local.set({ serverListPreferences: { sort: $("#serverSort").value, autoPing: $("#autoPing").checked } });
}

function render(status) {
  status = normalizeRenderableStatus(status);
  currentStatus = status;
  const active = status.enabled && status.configured;
  setSwitch($("#masterToggle"), active);
  setSwitch($("#communityToggle"), status.useCommunityList);
  document.querySelectorAll(".route-mode-button").forEach((button) => {
    const selected = button.dataset.routeMode === status.routeMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const listPanel = document.querySelector(".list-panel");
  const selectedMode = status.routeMode !== "all";
  listPanel.classList.toggle("is-disabled", !selectedMode);
  $("#communityToggle").disabled = !selectedMode;
  $("#communityLabel").textContent = `${status.communityCount.toLocaleString("ru-RU")} сайтов для России`;
  $("#routeFooter").lastChild.textContent = status.routeMode === "all"
    ? " Весь интернет идёт через VPN, кроме исключений"
    : " Остальные сайты подключаются напрямую";
  renderServerDeck(status);
  populateServerFilter();
  renderServerSearch();
  renderUpdateNotice(status.updateNotice);
  if (listOpen) $("#updateCard").classList.add("hidden");

  if (currentHost) {
    $("#currentSitePanel").classList.remove("is-disabled");
    $("#currentHost").textContent = currentHost;
    $("#siteMark").textContent = currentHost[0].toUpperCase();
    setSwitch($("#siteToggle"), status.currentRouted);
    $("#currentSitePanel").classList.toggle("is-routed", status.currentRouted);
  } else {
    $("#currentSitePanel").classList.add("is-disabled");
    $("#currentHost").textContent = "Служебная страница";
    $("#siteMark").textContent = "—";
  }
}

async function getActiveHost() {
  if (PREVIEW) return "chatgpt.com";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || "");
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}

async function refresh() {
  currentHost = await getActiveHost();
  const next = await send("getStatus", { host: currentHost });
  render(next);
  try {
    const cached = await send("getServerLatencies");
    for (const [id, value] of Object.entries(cached || {})) {
      const latency = normalizeLatency(value);
      if (latency) latencies.set(id, latency);
    }
  } catch {
    // A decorative cache failure must not discard the working server list.
  }
  renderServerSearch();
  if (!PREVIEW && next.enabled && next.configured && !next.activeServer?.exitIp) {
    probeLocationInBackground(next.activeServerId);
  }
  return next;
}

function probeLocationInBackground(serverId) {
  if (PREVIEW || !serverId || locationProbeServerId === serverId) return;
  locationProbeServerId = serverId;
  send("probeLocation", { host: currentHost })
    .then((next) => {
      if (currentStatus?.activeServerId === serverId) render(next);
    })
    .catch(() => {
      // Location is decorative. It must never hide or block the server list.
    })
    .finally(() => {
      if (locationProbeServerId === serverId) locationProbeServerId = null;
    });
}

$("#masterToggle").addEventListener("click", async () => {
  let status = currentStatus;
  if (!status || status.activeServerId === "unavailable") {
    try {
      status = await send("getStatus", { host: currentHost });
      render(status);
    } catch (error) {
      showNotice(error.message, "error");
      return;
    }
  }
  if (!status.configured) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  const previousStatus = status;
  const enabled = !status.enabled;
  render({ ...status, enabled });
  try {
    render(await send("setEnabled", { enabled, host: currentHost }));
  } catch (error) {
    render(previousStatus);
    showNotice(error.message, "error");
  }
});

$("#siteToggle").addEventListener("click", async () => {
  if (!requireStatus()) return;
  if (!currentHost) return;
  try {
    render(await send("toggleDomain", { host: currentHost }));
    showNotice(currentStatus.currentRouted ? "Сайт пойдёт через VPN" : "Сайт подключится напрямую", "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

$("#communityToggle").addEventListener("click", async () => {
  if (!requireStatus()) return;
  try {
    await send("setCommunityList", { enabled: !currentStatus.useCommunityList });
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
  }
});

document.querySelectorAll(".route-mode-button").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!requireStatus()) return;
    const routeMode = button.dataset.routeMode;
    if (routeMode === currentStatus.routeMode) return;
    try {
      render(await send("setRouteMode", { routeMode, host: currentHost }));
      showNotice(routeMode === "all" ? "Весь интернет пойдёт через VPN" : "VPN работает только для списка", "success");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
});

$("#serverPrev").addEventListener("click", () => navigateDeck(-1));
$("#serverNext").addEventListener("click", () => navigateDeck(1));

$("#serverSearchInput").addEventListener("input", renderServerSearch);
$("#serverSearchInput").addEventListener("focus", renderServerSearch);
$("#serverSearchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (event.currentTarget.value) closeServerSearch({ clear: true });
    else setListOpen(false);
  }
});
$("#serverSearchClear").addEventListener("click", () => {
  closeServerSearch({ clear: true });
  $("#serverSearchInput").focus();
});
$("#openServerList").addEventListener("click", () => setListOpen(true));
$("#closeServerList").addEventListener("click", () => setListOpen(false));
$("#pingAll").addEventListener("click", () => pingAll());
$("#serverFilter").addEventListener("change", renderServerSearch);
$("#serverSort").addEventListener("change", () => {
  renderServerSearch();
  saveListPreferences().catch(() => showNotice("Не удалось сохранить сортировку", "error"));
});
$("#autoPing").addEventListener("change", () => {
  saveListPreferences().catch(() => showNotice("Не удалось сохранить настройку", "error"));
});
$("#serverSearchResults").addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const buttons = [...$("#serverSearchResults").querySelectorAll(".server-choice")];
  const index = buttons.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault();
  buttons[Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && listOpen && event.target !== $("#serverSearchInput")) {
    event.preventDefault();
    setListOpen(false);
  }
});
window.addEventListener("pagehide", () => { if (batch) batch.cancelled = true; });
window.setInterval(() => {
  if (!listOpen) return;
  const servers = new Map(currentDeckItems.map((item) => [item.id, item]));
  for (const row of $("#serverSearchResults").children) {
    const button = row.querySelector(".server-latency");
    const server = servers.get(row.dataset.serverId);
    if (button && server) updateLatencyButton(button, server);
  }
}, 30000); // Only refresh stale labels while popup is open; no network or background ping.

$("#serverDeck").addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  swipeStartX = event.clientX;
});

$("#serverDeck").addEventListener("pointerup", (event) => {
  if (swipeStartX === null) return;
  const distance = event.clientX - swipeStartX;
  swipeStartX = null;
  if (Math.abs(distance) < 42) return;
  navigateDeck(distance > 0 ? -1 : 1);
});

$("#serverDeck").addEventListener("pointercancel", () => {
  swipeStartX = null;
});

$("#dismissUpdate").addEventListener("click", async () => {
  if (!requireStatus()) return;
  try {
    await send("dismissUpdateNotice");
    currentStatus.updateNotice = null;
    renderUpdateNotice(null);
  } catch (error) {
    showNotice(error.message, "error");
  }
});

$("#openSettings").addEventListener("click", () => {
  if (PREVIEW) location.href = "options.html?preview=1";
  else chrome.runtime.openOptionsPage();
});

refresh()
  .then(() => {
    if (!PREVIEW) chrome.storage.local.get("serverListPreferences").then(({ serverListPreferences: prefs }) => {
      if (["original", "name", "latency"].includes(prefs?.sort)) $("#serverSort").value = prefs.sort;
      $("#autoPing").checked = prefs?.autoPing === true;
      renderServerSearch();
    }).catch(() => {});
    if (PREVIEW_SEARCH) {
      $("#serverSearchInput").value = PREVIEW_SEARCH;
      renderServerSearch();
    }
    if (PREVIEW && (PREVIEW_PARAMS.has("list") || PREVIEW_SEARCH)) setListOpen(true);
    if (PREVIEW_AUTO_NEXT) requestAnimationFrame(() => $("#serverNext").click());
  })
  .catch((error) => {
    render({
      enabled: false,
      configured: false,
      activeServer: {
        id: "unavailable",
        name: "Не удалось загрузить серверы",
        protocolLabel: "VPN"
      },
      servers: []
    });
    showNotice(error.message, "error");
  });
