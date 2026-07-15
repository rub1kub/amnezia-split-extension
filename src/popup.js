const $ = (selector) => document.querySelector(selector);
const PREVIEW = new URLSearchParams(location.search).has("preview");

const PREVIEW_STATUS = {
  enabled: true,
  configured: true,
  useCommunityList: true,
  communityCount: 1687,
  activeCount: 1692,
  currentRouted: true,
  activeServerId: "server-1",
  servers: [
    { id: "server-1", name: "Нидерланды", protocolLabel: "HTTPS", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.10" },
    { id: "server-2", name: "Happ · Германия", protocolLabel: "SOCKS5", countryCode: "DE", countryName: "Германия", flag: "🇩🇪", exitIp: "198.51.100.24" }
  ],
  activeServer: { id: "server-1", name: "Нидерланды", protocolLabel: "HTTPS", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.10" },
  updateNotice: {
    kind: "installed",
    version: "0.4.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.4.0"
  }
};

let currentHost = "";
let currentStatus = null;
let carouselTimer = null;
let renderingCarousel = false;

async function send(type, payload = {}) {
  if (PREVIEW) {
    if (type === "setEnabled") PREVIEW_STATUS.enabled = payload.enabled;
    if (type === "toggleDomain") PREVIEW_STATUS.currentRouted = !PREVIEW_STATUS.currentRouted;
    if (type === "setCommunityList") PREVIEW_STATUS.useCommunityList = payload.enabled;
    if (type === "selectServer") PREVIEW_STATUS.activeServerId = payload.id;
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

function activeCopy(status) {
  const active = status.enabled && status.configured;
  return {
    active,
    eyebrow: status.configured ? (active ? "ЗАЩИТА АКТИВНА" : "НА ПАУЗЕ") : "НУЖНА НАСТРОЙКА",
    title: status.configured ? (active ? "VPN включён" : "VPN выключен") : "Настройте сервер",
    text: status.configured
      ? (active ? "Только выбранные сайты" : "Все сайты подключаются напрямую")
      : "Откройте настройки"
  };
}

function createServerSlide(server, status) {
  const copy = activeCopy(status);
  const slide = makeElement("article", `status-card server-slide${copy.active ? "" : " is-off"}`);
  slide.dataset.serverId = server.id;
  const top = makeElement("div", "server-slide-top");
  const protocol = makeElement("span", "protocol-pill", server.protocolLabel || String(server.scheme || "HTTPS").toUpperCase());
  const countryCode = String(server.countryCode || "").toLowerCase();
  const flag = /^[a-z]{2}$/.test(countryCode)
    ? makeElement("img", "country-flag country-flag-image")
    : makeElement("span", "country-flag", "🌐");
  flag.title = server.countryName || "Страна определится после проверки";
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
      : "Страна определится после проверки"
  );
  serverInfo.append(serverName, locationText);
  const count = makeElement("div", "route-count");
  count.append(makeElement("strong", "", status.activeCount.toLocaleString("ru-RU")), makeElement("span", "", "доменов через VPN"));
  slide.append(top, copyWrap, serverInfo, count);
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
}

function renderServerDeck(status) {
  const track = $("#serverTrack");
  renderingCarousel = true;
  track.replaceChildren(...status.servers.map((server) => createServerSlide(server, status)));
  const dots = $("#serverDots");
  dots.replaceChildren(...status.servers.map((server, index) => {
    const dot = makeElement("button", "server-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", `Выбрать сервер ${server.name}`);
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
  $("#communityLabel").textContent = `${status.communityCount.toLocaleString("ru-RU")} сайтов для России`;
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
  render(await send("getStatus", { host: currentHost }));
}

$("#masterToggle").addEventListener("click", async () => {
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
  if (!currentHost) return;
  try {
    render(await send("toggleDomain", { host: currentHost }));
    showNotice(currentStatus.currentRouted ? "Сайт пойдёт через VPN" : "Сайт подключится напрямую", "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

$("#communityToggle").addEventListener("click", async () => {
  try {
    await send("setCommunityList", { enabled: !currentStatus.useCommunityList });
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
  }
});

$("#serverTrack").addEventListener("scroll", () => {
  if (renderingCarousel) return;
  clearTimeout(carouselTimer);
  carouselTimer = setTimeout(async () => {
    const index = closestSlideIndex();
    updateCarouselMeta(index);
    const server = currentStatus?.servers?.[index];
    if (!server || server.id === currentStatus.activeServerId) return;
    try {
      render(await send("selectServer", { id: server.id }));
      showNotice(`Выбран: ${server.name}`, "success");
    } catch (error) {
      showNotice(error.message, "error");
    }
  }, 140);
}, { passive: true });

$("#dismissUpdate").addEventListener("click", async () => {
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
