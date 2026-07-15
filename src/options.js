const $ = (selector) => document.querySelector(selector);
const PREVIEW = new URLSearchParams(location.search).has("preview");
const PREVIEW_STATUS = {
  enabled: true,
  configured: true,
  routeMode: "selected",
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
    scheme: "https",
    protocolLabel: "HTTPS",
    username: "amnezia-browser",
    password: "",
    countryCode: "NL",
    countryName: "Нидерланды",
    flag: "🇳🇱",
    exitIp: "203.0.113.10"
  },
  servers: [
    { id: "server-1", name: "Основной сервер", host: "ton4.pro", port: 18443, scheme: "https", protocolLabel: "HTTPS", username: "amnezia-browser", password: "", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.10", source: "manual" },
    { id: "gateway-node-1", name: "🇪🇺 Авто · Самый быстрый", host: "ton4.pro", port: 18443, scheme: "https", protocolLabel: "VLESS", username: "amnezia-browser", password: "", countryCode: "NL", countryName: "Нидерланды", flag: "🇳🇱", exitIp: "203.0.113.11", source: "gateway", subscriptionId: "sub-1" },
    { id: "gateway-node-2", name: "🇩🇪 Германия · Hysteria 2", host: "ton4.pro", port: 18443, scheme: "https", protocolLabel: "Hysteria 2", username: "amnezia-browser", password: "", countryCode: "DE", countryName: "Германия", flag: "🇩🇪", exitIp: "198.51.100.25", source: "gateway", subscriptionId: "sub-1" }
  ],
  gateway: { enabled: true, connected: true, apiUrl: "https://ton4.pro:18445", proxyServerId: "server-1" },
  subscriptions: [{
    id: "sub-1",
    name: "Quattro",
    origin: "https://provider.example",
    url: "https://provider.example/private-token",
    updatedAt: "2026-07-15T12:00:00.000Z",
    nodeCount: 285,
    compatibleCount: 285,
    companionCount: 0,
    gatewayManaged: true,
    protocols: ["hysteria2", "ss", "vless"],
    nodes: [
      { name: "EU Auto | Самый быстрый", protocolLabel: "VLESS", compatible: true },
      { name: "LTE Auto · Нидерланды", protocolLabel: "VLESS", compatible: true },
      { name: "LTE Auto · Великобритания", protocolLabel: "VLESS", compatible: true },
      { name: "LTE Auto · Швеция", protocolLabel: "VLESS", compatible: true },
      { name: "LTE Auto · Германия", protocolLabel: "VLESS", compatible: true },
      { name: "LTE Auto · Латвия", protocolLabel: "VLESS", compatible: true },
      { name: "Бельгия", protocolLabel: "VLESS", compatible: true },
      { name: "Быстрые", protocolLabel: "Hysteria 2", compatible: true }
    ]
  }],
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
    version: "0.7.1",
    url: "https://github.com/rub1kub/amnezia-split-extension/releases/tag/v0.7.1"
  }
};
let status = null;
let editingServerId = null;
let domainLimit = 100;

async function send(type, payload = {}) {
  if (PREVIEW) {
    if (type === "setCommunityList") PREVIEW_STATUS.useCommunityList = payload.enabled;
    if (type === "setRouteMode") PREVIEW_STATUS.routeMode = payload.routeMode;
    if (type === "dismissUpdateNotice") PREVIEW_STATUS.updateNotice = null;
    if (type === "selectServer") {
      PREVIEW_STATUS.activeServerId = payload.id;
      PREVIEW_STATUS.activeServer = PREVIEW_STATUS.servers.find((item) => item.id === payload.id) || PREVIEW_STATUS.activeServer;
    }
    if (type === "connectSubscription" || type === "refreshSubscription") return { ...PREVIEW_STATUS };
    if (type === "deleteSubscription") {
      PREVIEW_STATUS.subscriptions = PREVIEW_STATUS.subscriptions.filter((item) => item.id !== payload.id);
    }
    return { ...PREVIEW_STATUS };
  }
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Расширение не ответило");
  return response.data;
}

function setSwitch(element, checked) {
  element.setAttribute("aria-checked", String(Boolean(checked)));
}

function setConnectionMethod(method) {
  const subscription = method === "subscription";
  $("#manualConnectionPanel").classList.toggle("hidden", subscription);
  $("#subscriptionConnectionPanel").classList.toggle("hidden", !subscription);
  document.querySelectorAll(".connection-method-tab").forEach((button) => {
    const selected = button.dataset.connectionMethod === method;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
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

function protocolLabel(protocol) {
  return {
    http: "HTTP",
    https: "HTTPS",
    socks4: "SOCKS4",
    socks5: "SOCKS5",
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

function renderSubscriptions(subscriptions = []) {
  const container = $("#subscriptionList");
  container.replaceChildren();
  if (!subscriptions.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Подписок пока нет";
    container.append(empty);
    return;
  }

  subscriptions.forEach((subscription) => {
    const card = document.createElement("article");
    card.className = "subscription-card";
    const main = document.createElement("div");
    main.className = "subscription-main";
    const title = document.createElement("strong");
    title.textContent = subscription.name;
    const meta = document.createElement("span");
    const date = subscription.updatedAt
      ? new Date(subscription.updatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
      : "ещё не обновлялась";
    meta.textContent = `${subscription.nodeCount} узлов на Routeva Gateway · ${date}`;
    const protocols = document.createElement("div");
    protocols.className = "subscription-protocols";
    (subscription.protocols || []).forEach((protocol) => {
      const pill = document.createElement("span");
      pill.textContent = protocolLabel(protocol);
      protocols.append(pill);
    });
    main.append(title, meta, protocols);

    const actions = document.createElement("div");
    actions.className = "subscription-actions";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "Обновить";
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      try {
        render(await send("refreshSubscription", { id: subscription.id }));
        toast("Подписка обновлена");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        refreshButton.disabled = false;
      }
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete";
    deleteButton.textContent = "Удалить";
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Удалить подписку «${subscription.name}» и её прокси-серверы?`)) return;
      try {
        render(await send("deleteSubscription", { id: subscription.id }));
        toast("Подписка удалена");
      } catch (error) {
        toast(error.message, "error");
      }
    });
    actions.append(refreshButton, deleteButton);

    const nodes = document.createElement("div");
    nodes.className = "subscription-nodes";
    (subscription.nodes || []).slice(0, 8).forEach((node) => {
      const row = document.createElement("div");
      row.className = "subscription-node";
      const type = document.createElement("b");
      type.textContent = node.protocolLabel || protocolLabel(node.protocol);
      const name = document.createElement("span");
      name.textContent = node.name;
      const mode = document.createElement("em");
      mode.textContent = "Доступен";
      row.append(type, name, mode);
      nodes.append(row);
    });
    if ((subscription.nodes || []).length > 8) {
      const more = document.createElement("span");
      more.className = "empty-state";
      more.textContent = `Ещё ${(subscription.nodes.length - 8).toLocaleString("ru-RU")} узлов`;
      nodes.append(more);
    }
    card.append(main, actions, nodes);
    container.append(card);
  });
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

function renderServerEditor(next) {
  const manualServers = next.servers.filter((item) => item.source !== "gateway");
  if (!manualServers.some((item) => item.id === editingServerId)) {
    editingServerId = next.gateway?.proxyServerId
      || manualServers.find((item) => item.id === next.activeServerId)?.id
      || manualServers[0]?.id
      || null;
  }
  const select = $("#serverSelect");
  select.replaceChildren(...manualServers.map((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} · ${item.protocolLabel || protocolLabel(item.scheme)}`;
    return option;
  }));
  select.value = editingServerId || "";

  const server = manualServers.find((item) => item.id === editingServerId) || manualServers[0] || {};
  $("#serverName").value = server.name || "";
  $("#proxyScheme").value = server.scheme || "https";
  $("#proxyHost").value = server.host || "";
  $("#proxyPort").value = server.port || "";
  $("#proxyUsername").value = server.username || "";
  $("#proxyPassword").value = server.password || "";
  ["serverName", "proxyScheme", "proxyHost", "proxyPort", "proxyUsername", "proxyPassword", "showPassword", "saveAndTest"].forEach((id) => {
    $("#" + id).disabled = false;
  });
  $("#deleteServer").disabled = !editingServerId || manualServers.length <= 1;
}

function render(next) {
  if (!Array.isArray(next.domainEntries)) {
    next = { ...next, domainEntries: status?.domainEntries ?? [] };
  }
  status = next;
  renderServerEditor(next);
  document.querySelectorAll(".options-route-mode .route-mode-button").forEach((button) => {
    const selected = button.dataset.routeMode === next.routeMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#routeModeMeta").textContent = next.routeMode === "all"
    ? "Весь интернет через VPN, кроме исключений"
    : "Только сайты из списка";
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
  renderSubscriptions(next.subscriptions || []);
  renderDomainViewer();
}

async function refresh() {
  const next = await send("getStatus", { includeCredentials: true, includeDomains: true });
  render(next);
  const connectId = new URLSearchParams(location.search).get("connect");
  if (connectId) {
    const subscription = next.subscriptions?.find((item) => item.id === connectId);
    if (subscription) {
      setConnectionMethod("subscription");
      $("#subscriptionConnectionPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("connect");
    history.replaceState(null, "", cleanUrl);
  }
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
        scheme: $("#proxyScheme").value,
        username: $("#proxyUsername").value,
        password: $("#proxyPassword").value
      }
    });
    const test = await send("testProxy");
    result.className = "test-result success";
    result.textContent = `Готово: ${test.directIp} → ${test.proxyIp} · ${test.flag || "🌐"} ${test.countryName || ""}`;
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

$("#serverSelect").addEventListener("change", (event) => {
  editingServerId = event.target.value;
  renderServerEditor(status);
  $("#testResult").className = "test-result hidden";
});

$("#newServer").addEventListener("click", () => {
  setConnectionMethod("manual");
  editingServerId = null;
  ["serverName", "proxyScheme", "proxyHost", "proxyPort", "proxyUsername", "proxyPassword", "showPassword", "saveAndTest"].forEach((id) => {
    $("#" + id).disabled = false;
  });
  $("#serverName").value = `Сервер ${status.servers.length + 1}`;
  $("#proxyScheme").value = "https";
  $("#proxyHost").value = "";
  $("#proxyPort").value = "";
  $("#proxyUsername").value = "";
  $("#proxyPassword").value = "";
  $("#serverName").focus();
  $("#testResult").className = "test-result hidden";
});

document.querySelectorAll(".connection-method-tab").forEach((button) => {
  button.addEventListener("click", () => setConnectionMethod(button.dataset.connectionMethod));
});

document.querySelectorAll(".options-route-mode .route-mode-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const routeMode = button.dataset.routeMode;
    if (routeMode === status.routeMode) return;
    try {
      render(await send("setRouteMode", { routeMode }));
      toast(routeMode === "all" ? "Весь интернет пойдёт через VPN" : "Включён режим по списку");
    } catch (error) {
      toast(error.message, "error");
    }
  });
});

$("#showSubscriptionUrl").addEventListener("click", () => {
  const input = $("#subscriptionUrl");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("#showSubscriptionUrl").textContent = show ? "Скрыть" : "Показать";
});

$("#subscriptionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector(".primary-button");
  const rawUrl = $("#subscriptionUrl").value.trim();
  let url;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    toast("Введите HTTPS-ссылку подписки", "error");
    return;
  }

  button.disabled = true;
  button.querySelector("span").textContent = "Читаю подписку…";
  try {
    const next = await send("importSubscription", {
      subscription: {
        name: $("#subscriptionName").value.trim() || url.hostname,
        url: url.href
      }
    });
    render(next);
    $("#subscriptionName").value = "";
    $("#subscriptionUrl").value = "";
    const imported = next.subscriptions?.find((item) => item.url === url.href);
    toast(`Подписка добавлена на Gateway: ${imported?.nodeCount || 0} узлов доступны`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Добавить подписку";
  }
});

$("#deleteServer").addEventListener("click", async () => {
  const manualServers = status.servers.filter((item) => item.source !== "gateway");
  if (!editingServerId || manualServers.length <= 1) return;
  const server = status.servers.find((item) => item.id === editingServerId);
  if (!server || server.source === "gateway") return;
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
