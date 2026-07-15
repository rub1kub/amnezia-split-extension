export function compareVersions(left, right) {
  const a = String(left ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function releaseUrl(version) {
  const safeVersion = String(version ?? "").replace(/[^0-9.]/g, "");
  return safeVersion
    ? `https://github.com/rub1kub/amnezia-split-extension/releases/tag/v${safeVersion}`
    : "https://github.com/rub1kub/amnezia-split-extension/releases/latest";
}
