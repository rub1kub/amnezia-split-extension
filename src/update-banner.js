const HOST_ID = "routeva-update-banner";

function removeBanner() {
  document.getElementById(HOST_ID)?.remove();
}

function noticeText(notice) {
  return notice.kind === "installed"
    ? `Routeva обновлена до ${notice.version}`
    : `Доступно обновление Routeva ${notice.version}`;
}

function renderBanner(notice) {
  removeBanner();
  if (!notice) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .banner { position: fixed; z-index: 2147483647; top: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; max-width: min(620px, calc(100vw - 24px)); min-height: 44px; padding: 8px 10px 8px 14px; border: 1px solid rgba(111,91,231,.22); border-radius: 14px; color: #17241f; background: rgba(255,255,255,.96); box-shadow: 0 12px 34px rgba(24,31,29,.18); backdrop-filter: blur(14px); font: 600 13px/1.3 "Segoe UI Variable Text", "Segoe UI", sans-serif; }
    .dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: #6f5be7; box-shadow: 0 0 0 5px #f0edff; }
    .text { overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; }
    a { flex: 0 0 auto; color: #6552d8; text-decoration: none; font-size: 12px; }
    button { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; color: #71807a; background: #f1f4f3; cursor: pointer; font: 18px/1 "Segoe UI", sans-serif; }
    button:hover { color: #17241f; background: #e7ebe9; }
    @media (max-width: 520px) { .banner { gap: 9px; } .text { white-space: normal; } a { display: none; } }
  `;

  const banner = document.createElement("div");
  banner.className = "banner";
  banner.setAttribute("role", "status");
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = noticeText(notice);
  const link = document.createElement("a");
  link.href = notice.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Что нового";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Скрыть уведомление");
  close.textContent = "×";
  close.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "dismissUpdateNotice" }).catch(() => {});
    removeBanner();
  });

  banner.append(dot, text, link, close);
  shadow.append(style, banner);
  document.documentElement.append(host);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "updateNoticeChanged") renderBanner(message.notice);
});

chrome.runtime.sendMessage({ type: "getUpdateNotice" })
  .then((response) => renderBanner(response?.ok ? response.data : null))
  .catch(() => {});
