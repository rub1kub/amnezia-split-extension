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
