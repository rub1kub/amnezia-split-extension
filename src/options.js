const $ = (selector) => document.querySelector(selector);
const PREVIEW = new URLSearchParams(location.search).has("preview");
const PREVIEW_STATUS = {
  enabled: true,
  configured: true,
  useCommunityList: true,
  communityCount: 1183,
  communityUpdatedAt: "2026-07-15T00:00:00.000Z",
  customDomains: ["example.com", "claude.ai"],
  bypassDomains: ["status.openai.com"],
  proxy: {
    host: "ton4.pro",
    port: 18443,
    username: "amnezia-browser",
    password: ""
  }
};
let status = null;

async function send(type, payload = {}) {
  if (PREVIEW) {
    if (type === "setCommunityList") PREVIEW_STATUS.useCommunityList = payload.enabled;
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

function render(next) {
  status = next;
  $("#proxyHost").value = next.proxy.host || "";
  $("#proxyPort").value = next.proxy.port || "";
  $("#proxyUsername").value = next.proxy.username || "";
  $("#proxyPassword").value = next.proxy.password || "";
  setSwitch($("#optionsCommunityToggle"), next.useCommunityList);
  $("#listMeta").textContent = `${next.communityCount.toLocaleString("ru-RU")} доменов · ${
    next.communityUpdatedAt ? new Date(next.communityUpdatedAt).toLocaleDateString("ru-RU") : "не обновлялся"
  }`;
  $("#customCount").textContent = next.customDomains.length;
  $("#bypassCount").textContent = next.bypassDomains.length;
  renderChips($("#customDomains"), next.customDomains, "custom", "Пока нет своих сайтов");
  renderChips($("#bypassDomains"), next.bypassDomains, "bypass", "Исключений нет");
  $("#headerDot").classList.toggle("active", next.enabled && next.configured);
  $("#headerStatus").textContent = next.configured ? (next.enabled ? "Работает" : "На паузе") : "Не настроено";
}

async function refresh() {
  render(await send("getStatus", { includeCredentials: true }));
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
    await send("saveProxy", {
      proxy: {
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
