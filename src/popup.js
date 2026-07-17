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
    version: "0.8.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.8.0"
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
      source: "gateway"
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
const regionNames = typeof Intl.DisplayNames === "function"
  ? new Intl.DisplayNames(["ru"], { type: "region" })
  : null;

async function send(type, payload = {}) {
  if (PREVIEW) {
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
    makeElement("p", "", `${subscription.nodeCount.toLocaleString("ru-RU")} серверов в этой подписке`)
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
  currentDeckItems = [
    ...status.servers.map((server) => ({ ...server, kind: "server", selectable: true })),
    ...(status.subscriptionCards || [])
  ];
  const activeIndex = Math.max(0, status.servers.findIndex((server) => server.id === status.activeServerId));
  renderDeckIndex(status, activeIndex);
  renderServerSearch();
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
  $("#serverDeck").setAttribute("aria-busy", "true");
  updateCarouselMeta(currentDeckIndex);
  try {
    render(await send("selectServer", { id: item.id }));
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    navigationBusy = false;
    $("#serverDeck").removeAttribute("aria-busy");
    updateCarouselMeta(currentDeckIndex);
  }
}

function navigateDeck(step) {
  return selectDeckIndex(currentDeckIndex + step);
}

function closeServerSearch({ clear = false } = {}) {
  if (clear) $("#serverSearchInput").value = "";
  $("#serverSearchResults").classList.add("hidden");
  $("#serverSearchClear").classList.toggle("hidden", !$("#serverSearchInput").value);
}

function renderServerSearch() {
  const input = $("#serverSearchInput");
  const results = $("#serverSearchResults");
  const query = input.value.trim().toLocaleLowerCase("ru-RU");
  $("#serverSearchClear").classList.toggle("hidden", !query);
  results.replaceChildren();
  if (!query) {
    results.classList.add("hidden");
    return;
  }

  const matches = currentDeckItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "server" && searchableServerText(item).includes(query))
    .slice(0, 8);

  if (!matches.length) {
    results.append(makeElement("p", "server-search-empty", "Ничего не найдено"));
  } else {
    matches.forEach(({ item, index }) => {
      const button = makeElement("button", "server-search-result");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(item.id === currentStatus?.activeServerId));
      const copy = makeElement("span", "");
      copy.append(
        makeElement("strong", "", item.name || "Без названия"),
        makeElement("small", "", `${countryNameByCode(item.declaredCountryCode) || item.countryName || "Страна не указана"} · ${item.protocolLabel || protocolLabel(item.protocol)}`)
      );
      button.append(copy);
      button.addEventListener("click", async () => {
        closeServerSearch({ clear: true });
        await selectDeckIndex(index);
      });
      results.append(button);
    });
  }
  results.classList.remove("hidden");
}

function render(status) {
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
  renderUpdateNotice(status.updateNotice);

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
  let next = await send("getStatus", { host: currentHost });
  if (!PREVIEW && next.enabled && next.configured && !next.activeServer?.exitIp) {
    try {
      next = await send("probeLocation", { host: currentHost });
    } catch (error) {
      showNotice("Не удалось определить страну. Повторим при следующем открытии.", "error");
    }
  }
  render(next);
}

$("#masterToggle").addEventListener("click", async () => {
  if (!requireStatus()) return;
  if (!currentStatus.configured) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  try {
    render(await send("setEnabled", { enabled: !currentStatus.enabled, host: currentHost }));
  } catch (error) {
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
    closeServerSearch({ clear: true });
    event.currentTarget.blur();
  }
});
$("#serverSearchClear").addEventListener("click", () => {
  closeServerSearch({ clear: true });
  $("#serverSearchInput").focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#serverSearch")) closeServerSearch();
});

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
    if (PREVIEW_SEARCH) {
      $("#serverSearchInput").value = PREVIEW_SEARCH;
      renderServerSearch();
    }
    if (PREVIEW_AUTO_NEXT) requestAnimationFrame(() => $("#serverNext").click());
  })
  .catch((error) => showNotice(error.message, "error"));
