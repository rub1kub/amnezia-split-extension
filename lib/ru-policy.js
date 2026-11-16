export const RU_POLICY_URL = "/routing/ru-direct.json";
export function ruPolicyUrlForHost(host) {
  if (!host) return null;
  const url = new URL(`https://${host}`);
  if (!host || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) throw new Error("Некорректный адрес сервера правил");
  url.pathname = RU_POLICY_URL;
  return url.href;
}
export const RU_BASE_SUFFIXES = Object.freeze(["ru", "su", "xn--p1ai", "max.ru", "oneme.ru", "vk.com", "vk.me", "userapi.com", "vk-cdn.net", "ok.ru", "yandex.com", "yandex.net", "yastatic.net"]);

const isDomain = (s) => typeof s === "string" && s.length <= 253 && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(s);
const protectedDomains = ["openai.com", "chatgpt.com", "claude.ai", "youtube.com", "googlevideo.com", "telegram.org", "t.me", "discord.com", "instagram.com", "whatsapp.com"];

export function validateRuPolicy(input) {
  if (!input || input.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(input.id || "")) throw new Error("Некорректная версия правил обхода");
  const date = Date.parse(input.generatedAt);
  if (!Number.isFinite(date) || date > Date.now() + 86400000) throw new Error("Некорректная дата правил обхода");
  const suffixes = input.domainSuffixes, exact = input.exactDomains, ranges = input.ipv4Ranges, v6 = input.ipv6Cidrs;
  if (!Array.isArray(suffixes) || suffixes.length < 100 || suffixes.length > 10000 || !suffixes.every(isDomain)
      || !Array.isArray(exact) || exact.length > 10000 || !exact.every(isDomain)
      || !Array.isArray(ranges) || ranges.length < 1000 || ranges.length > 50000
      || !Array.isArray(v6) || v6.length < 100 || v6.length > 20000
      || !v6.every((s) => typeof s === "string" && /^[0-9a-f:]+\/(?:[1-9][0-9]|1[01][0-9]|12[0-8])$/.test(s))) {
    throw new Error("Неполный или некорректный список обхода");
  }
  if (!["ru", "su", "xn--p1ai"].every((d) => suffixes.includes(d))) throw new Error("В списке отсутствуют российские зоны");
  for (const host of protectedDomains) {
    if (exact.includes(host) || suffixes.some((s) => host === s || host.endsWith(`.${s}`))) throw new Error("Иностранный сервис ошибочно включён в обход");
  }
  let previous = -1, total = 0;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)
        || range[0] <= previous || range[0] <= 0 || range[1] < range[0] || range[1] > 4294967295) throw new Error("Некорректные IP-диапазоны");
    total += range[1] - range[0] + 1;
    previous = range[1];
  }
  if (total < 1000000 || total > 200000000) throw new Error("Подозрительный размер IP-диапазонов");
  return { schemaVersion: 1, id: input.id, generatedAt: input.generatedAt, domainSuffixes: [...new Set(suffixes)],
    exactDomains: [...new Set(exact)], ipv4Ranges: ranges.map((r) => [...r]), ipv6Cidrs: [...new Set(v6)] };
}

export function ruDomainMatches(host, policy) {
  const suffixes = policy?.domainSuffixes || RU_BASE_SUFFIXES;
  return Boolean(host && ((policy?.exactDomains || []).includes(host) || suffixes.some((s) => host === s || host.endsWith(`.${s}`))));
}

export function ruIpMatches(host, policy) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host || "")) return false;
  const parts = host.split(".").map(Number);
  if (parts.some((n) => n > 255)) return false;
  const value = parts.reduce((v, n) => v * 256 + n, 0);
  const ranges = policy?.ipv4Ranges || [];
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (value < ranges[mid][0]) hi = mid - 1;
    else if (value > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}
