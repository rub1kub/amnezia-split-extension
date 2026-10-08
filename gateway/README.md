# Routeva Gateway

Routeva Gateway keeps protocol-specific VPN clients off the user's computer.
The extension connects to one authenticated HTTPS forward proxy; a dedicated
Mihomo instance on the user's server imports subscriptions and selects the
VLESS, Hysteria2, Shadowsocks, Trojan or other outbound.

Public ports used by the reference deployment:

- `18443/tcp` — existing HTTPS forward proxy used by Brave;
- `18445/tcp` — TLS control API, forwarded to `127.0.0.1:18446`;
- `18447/tcp` — dedicated Mihomo mixed proxy, loopback only;
- `18448/tcp` — dedicated Mihomo controller, loopback only.

Secrets and subscription URLs live only in `/etc/routeva-gateway` on the
server. Never copy `gateway.env`, `state.json`, generated provider files or
proxy credentials into Git.

## Reference installation

Prerequisites: Linux with systemd, Python 3.10+, an authenticated HTTPS
forward proxy on public port `18443`, stunnel (or another TLS terminator), and
the official Mihomo binary installed as `/usr/local/bin/routeva-mihomo`.

```bash
install -d -m 700 /etc/routeva-gateway/mihomo /opt/routeva-gateway
install -m 755 routeva_gateway.py /opt/routeva-gateway/routeva_gateway.py
install -m 644 routeva-gateway.service routeva-mihomo.service /etc/systemd/system/
```

Create `/etc/routeva-gateway/gateway.env` with mode `0600`:

```dotenv
ROUTEVA_API_USERNAME=replace-with-proxy-login
ROUTEVA_API_PASSWORD=replace-with-a-long-password
ROUTEVA_MIHOMO_SECRET=replace-with-an-independent-random-secret
```

Terminate TLS for the control API on the same hostname as the proxy and send
public port `18445` to `127.0.0.1:18446`. Send the forward proxy's upstream
traffic to `127.0.0.1:18447`. Do not expose ports `18446`–`18448` publicly.

After configuring the TLS terminator and forward proxy:

```bash
chmod 600 /etc/routeva-gateway/gateway.env
systemctl daemon-reload
systemctl enable --now routeva-mihomo routeva-gateway
systemctl restart stunnel4 tinyproxy
```

Check the API through its public TLS endpoint. It must request Basic Auth and
return `{"ready": true, ...}` only with valid credentials:

```bash
curl -u 'proxy-login:proxy-password' https://your-domain.example:18445/v1/health
```

The extension derives the Gateway URL from the active proxy hostname and uses
port `18445`. Provider files refresh in Mihomo every hour; the extension also
synchronizes its node cards every hour.

## Upgrade to 0.9.0

The new extension's node ping needs the updated Python API. An older Gateway can
still select nodes; it responds 404 to the new ping endpoint and the extension
shows an update instruction. No subscription reimport or Mihomo config rewrite is
needed for this upgrade.

On your Gateway server, back up the existing script, then install this release's
`gateway/routeva_gateway.py` and restart **only the control API**, not Mihomo or
your local Happ VPN:

```bash
sudo cp /opt/routeva-gateway/routeva_gateway.py /opt/routeva-gateway/routeva_gateway.py.before-0.9.0
sudo install -m 755 gateway/routeva_gateway.py /opt/routeva-gateway/routeva_gateway.py
sudo systemctl restart routeva-gateway
sudo systemctl status routeva-gateway --no-pager
```

Do not replace `/etc/routeva-gateway/gateway.env`, `state.json`, provider caches,
TLS files or the generated Mihomo config. Check `/v1/health` with your existing
credentials; it must include `"capabilities": ["node-ping"]`. To roll back, restore
the backed-up script and restart only `routeva-gateway`.

### Authenticated ping API

`POST /v1/nodes/ping` accepts `{"id":"<24-character node ID from /v1/status>"}`.
It uses the same Basic Auth as the rest of the API. Clients cannot override the
URL, port or controller path. Only nodes in `routeva_` providers can be tested.

Mihomo's [proxy delay endpoint](https://wiki.metacubex.one/api/) performs the
HTTPS URL-test through that specific outbound to the fixed
`https://www.gstatic.com/generate_204` target (6-second test timeout, expected
HTTP status 204). It does not
call `/proxies/ROUTEVA` with PUT, write config/state or restart any service. At most
four API tests run at once; excess requests return a safe `busy` result.

Successful response: `id`, `method: "gateway-proxy"`, `vantage: "gateway"`, fixed
`target`, `status: "ok"`, `delayMs`, `checkedAt`, `code: null`. Failures use
`timeout`, `unavailable` or `error`, with `delayMs: null` and a safe diagnostic
code. No subscription URL, secret or raw controller error is returned. The
measurement is from the Gateway, **not from the browser's PC**.
