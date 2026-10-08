// Tests only local project pages in an isolated browser. Never connects to a user's profile.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { chromium } = require(process.env.ROUTEVA_PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "artifacts", "audit", "v0.9.0");
const executablePath = process.env.ROUTEVA_BROWSER_PATH;

async function main() {
  await fs.mkdir(out, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep) || !["assets", "src", "lib", "data"].includes(path.relative(root, file).split(path.sep)[0])) throw new Error("Denied");
      const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/src/popup.html?preview&many`);
    await page.locator("#serverPosition").filter({ hasText: "286" }).waitFor();
    await page.screenshot({ path: path.join(out, "popup.png") });
    await page.locator("#openServerList").click();
    assert.equal(await page.locator(".server-row").count(), 286);
    assert.equal(await page.locator(".server-row.is-selected").count(), 1);
    await page.locator("#serverSearchInput").fill("Германия");
    assert.equal(await page.locator(".server-row").count(), 48);
    await page.locator("#serverSearchInput").fill("ZZ-not-a-server");
    assert.equal(await page.locator(".server-row").count(), 0);
    assert.match(await page.locator("#serverSearchResults").innerText(), /Ничего/);
    await page.locator("#serverSearchInput").fill("");
    await page.locator("#serverFilter").selectOption("sub-a");
    assert.equal(await page.locator(".server-row").count(), 143);
    await page.locator("#serverFilter").selectOption("all");
    await page.locator(".server-latency").first().click();
    await page.locator(".server-latency").first().filter({ hasText: "42 мс" }).waitFor();
    await page.locator("#serverSort").selectOption("latency");
    await page.screenshot({ path: path.join(out, "servers.png") });
    const bounds = await page.evaluate(() => {
      const list = document.querySelector("#serverSearchResults");
      return { width: document.documentElement.scrollWidth, bottom: list.getBoundingClientRect().bottom, scrollable: list.scrollHeight > list.clientHeight, height: document.documentElement.scrollHeight };
    });
    assert.equal(bounds.width, 380);
    assert.ok(bounds.bottom < 600 && bounds.scrollable && bounds.height <= 600, JSON.stringify(bounds));
    await page.locator("#pingAll").click();
    await page.locator("#pingAll").filter({ hasText: "Стоп" }).waitFor();
    await page.locator("#pingAll").click();
    await page.locator("#pingAll").filter({ hasText: "Пинг всех" }).waitFor();
    await page.locator("#closeServerList").click();
    assert.ok(await page.locator("#mainView").isVisible());
    await page.locator("#openServerList").click();
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#mainView").isVisible());

    // Real (non-preview) popup protocol with a simulated extension backend.
    const live = await browser.newPage({ viewport: { width: 380, height: 600 } });
    live.on("pageerror", (error) => errors.push(error.message));
    await live.addInitScript(() => {
      const servers = Array.from({ length: 12 }, (_, index) => ({ id: `node-${index}`, name: index === 11 ? '<img src=x onerror="window.HACKED=1">' : `Германия ${index + 1}`, protocolLabel: "VLESS", declaredCountryCode: "DE", source: "gateway", subscriptionId: "sub", subscriptionName: "Тестовая подписка", exitIp: "203.0.113.1" }));
      servers.push({ id: "manual", name: "Ручной прокси", protocolLabel: "HTTPS", source: "manual" });
      const state = { servers, activeServerId: "node-0", activeServer: servers[0], configured: true, enabled: true, activeCount: 50 };
      const store = {};
      window.__calls = [];
      window.__maxConcurrent = 0;
      let running = 0;
      window.chrome = {
        tabs: { query: async () => [{ url: "https://example.com/" }] },
        storage: { local: { get: async (key) => ({ [key]: store[key] }), set: async (data) => Object.assign(store, data) } },
        runtime: { sendMessage: async (message) => {
          window.__calls.push(message);
          if (message.type === "getServerLatencies") return { ok: true, data: store.cache || {} };
          if (message.type === "pingServer") {
            running++; window.__maxConcurrent = Math.max(window.__maxConcurrent, running);
            await new Promise((resolve) => setTimeout(resolve, 40));
            running--;
            const index = Number(message.id.split("-")[1]);
            const latency = { status: index === 2 ? "timeout" : "ok", delayMs: index === 2 ? null : 50 + index * 5, method: "gateway-proxy", checkedAt: new Date().toISOString() };
            store.cache ||= {}; store.cache[message.id] = latency;
            return { ok: true, data: { id: message.id, latency } };
          }
          if (message.type === "selectServer") { state.activeServerId = message.id; state.activeServer = servers.find((server) => server.id === message.id); }
          return { ok: true, data: { ...state } };
        } }
      };
    });
    await live.goto(`${origin}/src/popup.html`);
    await live.locator("#serverPosition").filter({ hasText: "13" }).waitFor();
    await live.locator("#openServerList").click();
    await live.locator("#pingAll").click();
    await live.locator("#pingAll").filter({ hasText: "Пинг всех" }).waitFor();
    assert.equal(await live.locator(".server-latency").filter({ hasText: "Тайм-аут" }).count(), 1);
    assert.equal(await live.locator(".server-latency:disabled").count(), 1);
    const calls = await live.evaluate(() => ({ calls: window.__calls, max: window.__maxConcurrent, hacked: window.HACKED }));
    assert.equal(calls.calls.filter((call) => call.type === "pingServer").length, 12);
    assert.equal(calls.calls.filter((call) => call.type === "selectServer").length, 0);
    assert.equal(calls.max, 3);
    assert.equal(calls.hacked, undefined);
    await live.locator('.server-row[data-server-id="node-1"] .server-choice').click();
    await live.locator('.server-row[data-server-id="node-1"].is-selected').waitFor();
    await live.locator("#serverSearchInput").fill("Германия");
    assert.equal(await live.locator(".server-row").count(), 12);
    await live.locator("#serverSearchInput").press("Escape");
    assert.equal(await live.locator(".server-row").count(), 13);
    await live.locator("#serverSort").selectOption("latency");
    await live.screenshot({ path: path.join(out, "servers-checked.png") });
    await live.close();
    assert.deepEqual(errors, []);
    console.log("UI smoke: 286-node list, search/filter/sort, batch cancel, real-popup messages, concurrency=3, timeout, XSS, selection, keyboard, 380×600 layout: PASS");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  // Actual MV3 load in an entirely new temporary Brave/Chromium profile.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "routeva-mv3-test-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(temp, {
      executablePath, headless: true, offline: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
      ignoreDefaultArgs: ["--disable-extensions"]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
    const status = await worker.evaluate(() => ({ version: chrome.runtime.getManifest().version, manifestVersion: chrome.runtime.getManifest().manifest_version }));
    assert.equal(status.version, "0.9.0");
    assert.equal(status.manifestVersion, 3);
    const extensionId = new URL(worker.url()).host;
    // Finish the install listener's automatic options navigation before opening our popup.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Install options page did not open")), 10000);
      const inspect = (candidate) => candidate.waitForURL(`chrome-extension://${extensionId}/src/options.html`, { timeout: 10000 })
        .then(() => { clearTimeout(timer); context.off("page", inspect); resolve(); }).catch(() => {});
      context.on("page", inspect);
      context.pages().forEach(inspect);
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
    await popup.locator("#serverPosition").filter({ hasText: "1 из 1" }).waitFor();
    await popup.locator("#openServerList").click();
    await popup.locator(".server-row").first().waitFor();
    assert.equal(await popup.locator(".server-row").count(), 1);
    assert.equal(await popup.locator("#pingAll").isDisabled(), true);
    const response = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "getStatus" }));
    assert.equal(response.ok, true);
    assert.equal(response.data.servers.length, 1);
    console.log("Actual isolated Brave MV3 install: version 0.9.0, service worker and popup: PASS");
  } finally {
    if (context) await context.close();
    // temp was created above; deletion cannot target the user's ordinary browser profile.
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(temp).startsWith("routeva-mv3-test-")) throw new Error("Unsafe temp path");
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
