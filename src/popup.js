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
    { id: "server-1", name: "Основной сервер" },
    { id: "server-2", name: "Резервный" }
  ],
  updateNotice: {
    kind: "installed",
    version: "0.3.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.3.0"
  }
};

let currentHost = "";
let currentStatus = null;

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

function render(status) {
  currentStatus = status;
  const active = status.enabled && status.configured;
  $("#statusCard").classList.toggle("is-off", !active);
  $("#statusEyebrow").textContent = status.configured
    ? active
      ? "ЗАЩИТА АКТИВНА"
      : "НА ПАУЗЕ"
    : "НУЖНА НАСТРОЙКА";
  $("#statusTitle").textContent = status.configured
    ? active
      ? "VPN включён"
      : "VPN выключен"
    : "Один шаг до старта";
  $("#statusText").textContent = status.configured
    ? active
      ? "Только выбранные сайты"
      : "Все сайты подключаются напрямую"
    : "Укажите пароль сервера";
  $("#activeCount").textContent = status.activeCount.toLocaleString("ru-RU");
  setSwitch($("#masterToggle"), active);
  setSwitch($("#communityToggle"), status.useCommunityList);
  $("#communityLabel").textContent = `${status.communityCount.toLocaleString("ru-RU")} сайтов для России`;
  const serverSelect = $("#serverSelect");
  serverSelect.replaceChildren(...status.servers.map((server) => {
    const option = document.createElement("option");
    option.value = server.id;
    option.textContent = server.name;
    return option;
  }));
  serverSelect.value = status.activeServerId;
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

$("#serverSelect").addEventListener("change", async (event) => {
  try {
    await send("selectServer", { id: event.target.value });
    await refresh();
    showNotice("Сервер переключён", "success");
  } catch (error) {
    showNotice(error.message, "error");
  }
});

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
