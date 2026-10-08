// A Gateway measurement is not an ICMP ping from the browser's computer.
export const LATENCY_FRESH_MS = 5 * 60 * 1000;

export function normalizeLatency(value) {
  if (!value || typeof value !== "object") return null;
  const status = ["ok", "timeout", "unavailable", "error", "unsupported"].includes(value.status)
    ? value.status : "error";
  const validDelay = typeof value.delayMs === "number" && Number.isFinite(value.delayMs)
    && value.delayMs >= 1 && value.delayMs <= 60000;
  const timestamp = Date.parse(value.checkedAt);
  return {
    status: status === "ok" && !validDelay ? "error" : status,
    delayMs: status === "ok" && validDelay ? Math.round(value.delayMs) : null,
    method: "gateway-proxy",
    checkedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    code: ["timeout", "unavailable", "busy", "core-unavailable", "invalid-response", "gateway-update", "unsupported", "api-error"].includes(value.code)
      ? value.code : null
  };
}

export function isLatencyFresh(value, now = Date.now()) {
  const time = Date.parse(value?.checkedAt);
  return Number.isFinite(time) && now >= time && now - time < LATENCY_FRESH_MS;
}

export function latencyLabel(value) {
  if (!value) return "—";
  if (value.status === "ok") return `${value.delayMs} мс`;
  return { timeout: "Тайм-аут", unavailable: "Недоступен", unsupported: "Н/Д", error: "Ошибка" }[value.status] || "—";
}

export function latencyTone(value) {
  if (!value) return "unknown";
  if (value.status !== "ok") return value.status === "unsupported" ? "unknown" : "error";
  return value.delayMs <= 150 ? "good" : value.delayMs <= 400 ? "medium" : "slow";
}

export function sortByLatency(items) {
  // Stable order for unknown/failed measurements; never equate unknown with 0 ms.
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ad = a.item.latency?.status === "ok" ? a.item.latency.delayMs : Infinity;
      const bd = b.item.latency?.status === "ok" ? b.item.latency.delayMs : Infinity;
      return ad - bd || a.index - b.index;
    }).map(({ item }) => item);
}
