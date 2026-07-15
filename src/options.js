const $ = (selector) => document.querySelector(selector);
const PREVIEW = new URLSearchParams(location.search).has("preview");
const PREVIEW_STATUS = {
  enabled: true,
  configured: true,
  useCommunityList: true,
  communityCount: 1687,
  communitySources: [
    { id: "itdog", name: "itdoginfo — Россия", count: 1183 },
    { id: "refilter", name: "Re-filter — сообщество", count: 672 },
    { id: "google-ai", name: "itdoginfo — Google AI", count: 28 }
  ],
  communityUpdatedAt: "2026-07-15T00:00:00.000Z",
  customDomains: ["example.com", "claude.ai"],
  bypassDomains: ["status.openai.com"],
  activeServerId: "server-1",
  activeServer: {
    id: "server-1",
    name: "Основной сервер",
    host: "ton4.pro",
    port: 18443,
    username: "amnezia-browser",
    password: ""
  },
  servers: [
    { id: "server-1", name: "Основной сервер", host: "ton4.pro", port: 18443, username: "amnezia-browser", password: "" },
    { id: "server-2", name: "Резервный", host: "backup.example.com", port: 443, username: "user", password: "demo" }
  ],
  domainEntries: [
    { domain: "chatgpt.com", source: "core" },
    { domain: "openai.com", source: "core" },
    { domain: "discord.com", source: "community" },
    { domain: "instagram.com", source: "community" },
    { domain: "youtube.com", source: "community" },
    { domain: "gemini.google.com", source: "community" },
    { domain: "example.com", source: "custom" }
  ],
  updateNotice: {
    kind: "installed",
    version: "0.3.0",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.3.0"
  }
};
let status = null;
let editingServerId = null;
let domainLimit = 100;

async function send(type, payload = {}) {
  if (PREVIEW) {
    if (type === "setCommunityList") PREVIEW_STATUS.useCommunityList = payload.enabled;
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

function toast(text, kind = "success") {
  const element = $("#toast");
  element.textContent = text;
  element.className = `toast ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 3200);
}

function makeChip(domain, type) {
  const chip = document.createElement("span");
  chip.className = "domain-chip";
  const label = document.createElement("span");
  label.textContent = domain;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "×";
  button.setAttribute("aria-label", `Удалить ${domain}`);
  button.addEventListener("click", async () => {
    try {
      await send(type === "custom" ? "removeCustomDomain" : "removeBypassDomain", { host: domain });
      await refresh();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  chip.append(label, button);
  return chip;
}

function renderChips(container, domains, type, emptyText) {
  container.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  domains.forEach((domain) => container.append(makeChip(domain, type)));
}

function sourceLabel(source) {
  return {
    core: "Встроено",
    community: "Готовый список",
    custom: "Добавлено вами"
  }[source] || "Через VPN";
}

function renderUpdateNotice(notice) {
  const card = $("#updateCard");
  card.classList.toggle("hidden", !notice);
  if (!notice) return;
  $("#updateText").textContent = notice.kind === "installed"
    ? `Обновлено до версии ${notice.version}`
    : `Доступна версия ${notice.version}`;
  $("#updateLink").href = notice.url;
}

function renderDomainViewer() {
  const entries = status?.domainEntries ?? [];
  const query = $("#domainSearch").value.trim().toLowerCase();
  const filtered = query
    ? entries.filter((entry) => entry.domain.includes(query))
    : entries;
  const visible = filtered.slice(0, domainLimit);
  const list = $("#domainList");
  list.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "domain-empty";
    empty.textContent = "Ничего не найдено";
    list.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    visible.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "domain-row";
      const dot = document.createElement("span");
      dot.className = `domain-source-dot ${entry.source}`;
      const domain = document.createElement("strong");
      domain.textContent = entry.domain;
      const source = document.createElement("span");
      source.textContent = sourceLabel(entry.source);
      row.append(dot, domain, source);
      fragment.append(row);
    });
    list.append(fragment);
  }

  $("#domainResultsMeta").textContent = query
    ? `Найдено ${filtered.length.toLocaleString("ru-RU")}`
    : `${filtered.length.toLocaleString("ru-RU")} доменов`;
  const more = $("#loadMoreDomains");
  more.classList.toggle("hidden", visible.length >= filtered.length);
  if (visible.length < filtered.length) {
    more.textContent = `Показать ещё · ${Math.min(100, filtered.length - visible.length)}`;
  }
}

function render(next) {
  if (!Array.isArray(next.domainEntries)) {
    next = { ...next, domainEntries: status?.domainEntries ?? [] };
  }
  status = next;
  editingServerId = next.activeServerId;
  const server = next.activeServer;
  const select = $("#serverSelect");
  select.replaceChildren(...next.servers.map((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    return option;
  }));
  select.value = next.activeServerId;
  $("#serverName").value = server.name || "";
  $("#proxyHost").value = server.host || "";
  $("#proxyPort").value = server.port || "";
  $("#proxyUsername").value = server.username || "";
  $("#proxyPassword").value = server.password || "";
  $("#deleteServer").disabled = next.servers.length <= 1;
  setSwitch($("#optionsCommunityToggle"), next.useCommunityList);
  $("#listMeta").textContent = `${next.communityCount.toLocaleString("ru-RU")} доменов · ${
    next.communityUpdatedAt ? new Date(next.communityUpdatedAt).toLocaleDateString("ru-RU") : "не обновлялся"
  }`;
  $("#domainSources").textContent = next.communitySources?.length
    ? `Источники: ${next.communitySources.map((source) => source.name).join(" · ")}`
    : "Источник: встроенный список";
  $("#customCount").textContent = next.customDomains.length;
  $("#bypassCount").textContent = next.bypassDomains.length;
  renderChips($("#customDomains"), next.customDomains, "custom", "Пока нет своих сайтов");
  renderChips($("#bypassDomains"), next.bypassDomains, "bypass", "Исключений нет");
  $("#headerDot").classList.toggle("active", next.enabled && next.configured);
  $("#headerStatus").textContent = next.configured ? (next.enabled ? "Работает" : "На паузе") : "Не настроено";
  renderUpdateNotice(next.updateNotice);
  renderDomainViewer();
}

async function refresh() {
  render(await send("getStatus", { includeCredentials: true, includeDomains: true }));
}

$("#showPassword").addEventListener("click", () => {
  const input = $("#proxyPassword");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("#showPassword").textContent = show ? "Скрыть" : "Показать";
});

$("#connectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#saveAndTest");
  const result = $("#testResult");
  button.disabled = true;
  button.querySelector("span").textContent = "Проверяю…";
  result.className = "test-result loading";
  result.textContent = "Создаём защищённое подключение";
  try {
    await send("saveServer", {
      server: {
        id: editingServerId,
        name: $("#serverName").value,
        host: $("#proxyHost").value,
        port: Number($("#proxyPort").value),
        username: $("#proxyUsername").value,
        password: $("#proxyPassword").value
      }
    });
    const test = await send("testProxy");
    result.className = "test-result success";
    result.textContent = `Готово: ${test.directIp} → ${test.proxyIp}`;
    toast("Подключение работает");
    await refresh();
  } catch (error) {
    result.className = "test-result error";
    result.textContent = `Не получилось: ${error.message}`;
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Сохранить и проверить";
  }
});

$("#serverSelect").addEventListener("change", async (event) => {
  try {
    render(await send("selectServer", { id: event.target.value }));
    toast("Сервер выбран");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#newServer").addEventListener("click", () => {
  editingServerId = null;
  $("#serverName").value = `Сервер ${status.servers.length + 1}`;
  $("#proxyHost").value = "";
  $("#proxyPort").value = "";
  $("#proxyUsername").value = "";
  $("#proxyPassword").value = "";
  $("#serverName").focus();
  $("#testResult").className = "test-result hidden";
});

$("#deleteServer").addEventListener("click", async () => {
  if (!editingServerId || status.servers.length <= 1) return;
  const server = status.servers.find((item) => item.id === editingServerId);
  if (!confirm(`Удалить сервер «${server?.name || "Без названия"}»?`)) return;
  try {
    render(await send("deleteServer", { id: editingServerId }));
    toast("Сервер удалён");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#optionsCommunityToggle").addEventListener("click", async () => {
  try {
    await send("setCommunityList", { enabled: !status.useCommunityList });
    await refresh();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#refreshList").addEventListener("click", async () => {
  const button = $("#refreshList");
  button.disabled = true;
  button.textContent = "Обновляю…";
  try {
    const result = await send("updateCommunityList");
    toast(`Обновлено: ${result.count.toLocaleString("ru-RU")} доменов`);
    await refresh();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Обновить";
  }
});

$("#toggleDomains").addEventListener("click", () => {
  const explorer = $("#domainExplorer");
  const opening = explorer.classList.contains("hidden");
  explorer.classList.toggle("hidden", !opening);
  $("#toggleDomains").textContent = opening ? "Скрыть домены" : "Посмотреть домены";
  if (opening) {
    domainLimit = 100;
    renderDomainViewer();
    $("#domainSearch").focus();
  }
});

$("#domainSearch").addEventListener("input", () => {
  domainLimit = 100;
  renderDomainViewer();
});

$("#loadMoreDomains").addEventListener("click", () => {
  domainLimit += 100;
  renderDomainViewer();
});

$("#dismissUpdate").addEventListener("click", async () => {
  try {
    await send("dismissUpdateNotice");
    renderUpdateNotice(null);
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#addDomainForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#newDomain");
  if (!input.value.trim()) return;
  try {
    await send("addDomain", { host: input.value });
    input.value = "";
    toast("Сайт добавлен");
    await refresh();
  } catch (error) {
    toast(error.message, "error");
  }
});

refresh().catch((error) => toast(error.message, "error"));
