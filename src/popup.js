const $ = (selector) => document.querySelector(selector);
const PREVIEW = new URLSearchParams(location.search).has("preview");

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
    version: "0.7.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.7.0"
  }
};

let currentHost = "";
let currentStatus = null;
let carouselTimer = null;
let renderingCarousel = false;
let currentDeckItems = [];

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
  const countryCode = String(server.countryCode || "").toLowerCase();
  if (/^[a-z]{2}$/.test(countryCode)) {
    slide.classList.add("has-country-backdrop");
    const backdrop = makeElement("img", "country-backdrop");
    backdrop.src = new URL(`../assets/flags/${countryCode}.svg`, location.href).href;
    backdrop.alt = "";
    backdrop.setAttribute("aria-hidden", "true");
    slide.append(backdrop);
  }
  const top = makeElement("div", "server-slide-top");
  const protocol = makeElement("span", "protocol-pill", server.protocolLabel || String(server.scheme || "HTTPS").toUpperCase());
  const flag = /^[a-z]{2}$/.test(countryCode)
    ? makeElement("img", "country-flag country-flag-image")
    : makeElement("span", "country-flag", "🌐");
  const isActive = server.id === status.activeServerId;
  const pendingLocation = isActive && !server.countryName;
  flag.title = server.countryName || (pendingLocation ? "Определяем страну выхода" : "Страна определится при выборе");
  if (flag instanceof HTMLImageElement) {
    flag.src = new URL(`../assets/flags/${countryCode}.svg`, location.href).href;
    flag.alt = server.countryName ? `Флаг: ${server.countryName}` : "Флаг страны сервера";
    flag.width = 28;
    flag.height = 21;
  }
  top.append(protocol, flag);

  const copyWrap = makeElement("div", "status-copy");
  copyWrap.append(
    makeElement("span", "eyebrow", copy.eyebrow),
    makeElement("h1", "", copy.title),
    makeElement("p", "", copy.text)
  );
  const serverInfo = makeElement("div", "server-slide-info");
  const serverName = makeElement("strong", "", server.name || "Без названия");
  const locationText = makeElement(
    "span",
    "",
    server.countryName
      ? `${server.countryName}${server.exitIp ? ` · ${server.exitIp}` : ""}`
      : pendingLocation ? "Определяем страну…" : "Страна определится при выборе"
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
    makeElement("p", "", `${subscription.nodeCount.toLocaleString("ru-RU")} узлов готовы на Routeva Gateway`)
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

function closestSlideIndex() {
  const track = $("#serverTrack");
  const slides = [...track.children];
  if (!slides.length) return 0;
  return slides.reduce((best, slide, index) =>
    Math.abs(slide.offsetLeft - track.scrollLeft) < Math.abs(slides[best].offsetLeft - track.scrollLeft)
      ? index
      : best, 0);
}

function updateCarouselMeta(index) {
  const dots = [...$("#serverDots").children];
  dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
  $("#serverPosition").textContent = `${index + 1} из ${Math.max(1, dots.length)} · листайте карточку`;
  const showingSubscription = currentDeckItems[index]?.kind === "subscription";
  $("#masterToggle").classList.toggle("hidden", showingSubscription);
  $("#serverDeck").classList.toggle("showing-subscription", showingSubscription);
}

function renderServerDeck(status) {
  const track = $("#serverTrack");
  renderingCarousel = true;
  currentDeckItems = [
    ...status.servers.map((server) => ({ ...server, kind: "server", selectable: true })),
    ...(status.subscriptionCards || [])
  ];
  track.replaceChildren(...currentDeckItems.map((item) => item.kind === "subscription"
    ? createSubscriptionSlide(item)
    : createServerSlide(item, status)));
  const dots = $("#serverDots");
  dots.replaceChildren(...currentDeckItems.map((item, index) => {
    const dot = makeElement("button", "server-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", item.kind === "subscription"
      ? `Открыть подписку ${item.name}`
      : `Выбрать сервер ${item.name}`);
    dot.addEventListener("click", () => {
      track.children[index]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    });
    return dot;
  }));
  const activeIndex = Math.max(0, status.servers.findIndex((server) => server.id === status.activeServerId));
  requestAnimationFrame(() => {
    const activeSlide = track.children[activeIndex];
    if (activeSlide) track.scrollLeft = activeSlide.offsetLeft;
    updateCarouselMeta(activeIndex);
    renderingCarousel = false;
  });
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
  render(next);
  if (!PREVIEW && next.enabled && next.configured && !next.activeServer?.countryCode) {
    try {
      next = await send("probeLocation", { host: currentHost });
      render(next);
    } catch (error) {
      showNotice("Не удалось определить страну. Повторим при следующем открытии.", "error");
    }
  }
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

$("#serverTrack").addEventListener("scroll", () => {
  if (renderingCarousel) return;
  clearTimeout(carouselTimer);
  carouselTimer = setTimeout(async () => {
    if (!currentStatus) return;
    const index = closestSlideIndex();
    updateCarouselMeta(index);
    const server = currentDeckItems[index];
    if (!server || server.kind !== "server" || server.id === currentStatus.activeServerId) return;
    try {
      render(await send("selectServer", { id: server.id }));
      showNotice(`Выбран: ${server.name}`, "success");
    } catch (error) {
      showNotice(error.message, "error");
    }
  }, 140);
}, { passive: true });

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

refresh().catch((error) => showNotice(error.message, "error"));
