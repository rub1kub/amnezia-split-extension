#!/usr/bin/env python3
"""Routeva Gateway: a small authenticated control plane for a dedicated Mihomo.

The browser extension only talks HTTPS to this API and to the existing HTTPS
forward proxy. Protocol-specific tunnels stay on the user's server.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


DATA_DIR = Path(os.environ.get("ROUTEVA_DATA_DIR", "/etc/routeva-gateway"))
STATE_PATH = DATA_DIR / "state.json"
MIHOMO_CONFIG = DATA_DIR / "mihomo" / "config.yaml"
MIHOMO_API = os.environ.get("ROUTEVA_MIHOMO_API", "http://127.0.0.1:18448")
MIHOMO_SECRET = os.environ.get("ROUTEVA_MIHOMO_SECRET", "")
API_USERNAME = os.environ.get("ROUTEVA_API_USERNAME", "")
API_PASSWORD = os.environ.get("ROUTEVA_API_PASSWORD", "")
LISTEN_HOST = os.environ.get("ROUTEVA_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("ROUTEVA_LISTEN_PORT", "18446"))
MIHOMO_SERVICE = os.environ.get("ROUTEVA_MIHOMO_SERVICE", "routeva-mihomo.service")
TLS_CERT = os.environ.get("ROUTEVA_TLS_CERT", "")
TLS_KEY = os.environ.get("ROUTEVA_TLS_KEY", "")
ACCOUNTS_PATH = DATA_DIR / "accounts.json"
MAX_BODY = 64 * 1024
STATE_LOCK = threading.RLock()
PING_SLOTS = threading.BoundedSemaphore(4)
PING_TEST_URL = "https://www.gstatic.com/generate_204"
PING_TIMEOUT_MS = 6000


class MihomoAPIError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def yaml_string(value: str) -> str:
    # JSON strings are valid YAML scalars and correctly escape subscription URLs.
    return json.dumps(str(value), ensure_ascii=False)


def accounts() -> dict[str, dict[str, Any]]:
    result = {"owner": {"id": "owner", "username": API_USERNAME, "password": API_PASSWORD,
                        "group": "ROUTEVA", "proxy_port": 18443, "role": "owner"}}
    if ACCOUNTS_PATH.exists():
        data = json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))
        for item in data.get("users", []):
            account_id = item.get("id", "")
            username = item.get("username", "")
            port = item.get("proxy_port")
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", account_id) or account_id in result:
                raise ValueError("Invalid Routeva account ID")
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", username) or not item.get("password"):
                raise ValueError("Invalid Routeva account credentials")
            if not isinstance(port, int) or isinstance(port, bool) or not 1024 <= port <= 65535:
                raise ValueError("Invalid Routeva account port")
            if any(a["username"] == username or a["proxy_port"] == port for a in result.values()):
                raise ValueError("Duplicate Routeva account credentials or port")
            result[account_id] = {**item, "group": "ROUTEVA_" + account_id.upper(), "role": "member"}
    return result


def account(account_id: str = "owner") -> dict[str, Any]:
    value = accounts().get(account_id)
    if value is None:
        raise PermissionError("Unknown Routeva account")
    return value


def saved_selection(state: dict[str, Any], account_id: str = "owner") -> str:
    return str(state.get("selected", "DIRECT") if account_id == "owner"
               else state.get("selections", {}).get(account_id, "DIRECT"))


def default_state() -> dict[str, Any]:
    return {"version": 1, "subscriptions": [], "selected": "DIRECT"}


def load_state() -> dict[str, Any]:
    with STATE_LOCK:
        if not STATE_PATH.exists():
            return default_state()
        try:
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default_state()
        data.setdefault("version", 1)
        data.setdefault("subscriptions", [])
        data.setdefault("selected", "DIRECT")
        return data


def save_state(state: dict[str, Any]) -> None:
    with STATE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temp = STATE_PATH.with_suffix(".tmp")
        temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(temp, 0o600)
        temp.replace(STATE_PATH)


def validate_subscription_url(raw: Any) -> str:
    value = str(raw or "").strip()
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Нужна обычная HTTPS-ссылка подписки")
    if len(value) > 4096:
        raise ValueError("Ссылка подписки слишком длинная")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ValueError("Не удалось найти сервер подписки") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise ValueError("Локальные адреса нельзя использовать как подписку")
    return urllib.parse.urlunsplit(parsed)


def provider_id(subscription_id: str) -> str:
    safe = "".join(ch for ch in subscription_id.lower() if ch.isalnum())[:24]
    return f"routeva_{safe or uuid.uuid4().hex[:12]}"


def provider_prefix(subscription_id: str) -> str:
    return f"[{provider_id(subscription_id)}] "


def render_mihomo_config(state: dict[str, Any]) -> str:
    subscriptions = state.get("subscriptions", [])
    lines = [
        "mixed-port: 18447",
        "allow-lan: false",
        "bind-address: 127.0.0.1",
        "mode: rule",
        "log-level: warning",
        "ipv6: true",
        "external-controller: 127.0.0.1:18448",
        f"secret: {yaml_string(MIHOMO_SECRET)}",
        "listeners:",
    ]
    for identity in accounts().values():
        lines.extend([
            f"  - name: routeva-{identity['id']}",
            "    type: http",
            "    listen: 0.0.0.0",
            f"    port: {identity['proxy_port']}",
            f"    proxy: {yaml_string(identity['group'])}",
            f"    certificate: {yaml_string(TLS_CERT)}",
            f"    private-key: {yaml_string(TLS_KEY)}",
            "    users:",
            f"      - username: {yaml_string(identity['username'])}",
            f"        password: {yaml_string(identity['password'])}",
        ])
    lines.extend(["profile:", "  store-selected: true", "  store-fake-ip: false", "proxy-providers:"])
    if not subscriptions:
        lines.append("  {}")
    for subscription in subscriptions:
        provider = provider_id(subscription["id"])
        lines.extend([
            f"  {provider}:",
            "    type: http",
            f"    url: {yaml_string(subscription['url'])}",
            f"    path: ./providers/{provider}.yaml",
            "    interval: 3600",
            "    header:",
            "      User-Agent:",
            "        - mihomo/1.18.9",
            "    override:",
            f"      additional-prefix: {yaml_string(provider_prefix(subscription['id']))}",
            "    health-check:",
            "      enable: true",
            "      url: https://www.gstatic.com/generate_204",
            "      interval: 600",
        ])
    lines.append("proxy-groups:")
    for account_id, identity in accounts().items():
        lines.extend([
            f"  - name: {yaml_string(identity['group'])}",
            "    type: select",
            f"    default-selected: {yaml_string(saved_selection(state, account_id))}",
            "    proxies:",
            "      - DIRECT",
        ])
        if subscriptions:
            lines.append("    use:")
            lines.extend(f"      - {provider_id(item['id'])}" for item in subscriptions)
    lines.extend([
        "rules:",
        "  - MATCH,ROUTEVA",
        "",
    ])
    return "\n".join(lines)


def write_mihomo_config(state: dict[str, Any]) -> None:
    MIHOMO_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    (MIHOMO_CONFIG.parent / "providers").mkdir(parents=True, exist_ok=True)
    temp = MIHOMO_CONFIG.with_suffix(".tmp")
    temp.write_text(render_mihomo_config(state), encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(MIHOMO_CONFIG)


def mihomo_request(path: str, method: str = "GET", payload: Any = None, timeout: float = 8) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{MIHOMO_API}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {MIHOMO_SECRET}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", "replace")[:300]
        raise MihomoAPIError(error.code, f"Mihomo API: HTTP {error.code} {message}") from error


def restart_mihomo() -> None:
    # Reload through the authenticated loopback API; no root access is needed.
    mihomo_request("/configs?force=true", method="PUT", payload={"path": str(MIHOMO_CONFIG)}, timeout=20)
    deadline = time.monotonic() + 20
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            mihomo_request("/version", timeout=2)
            return
        except Exception as error:  # service may still be starting
            last_error = error
            time.sleep(0.5)
    raise RuntimeError(f"Routeva tunnel не запустился: {last_error}")


def provider_snapshot(timeout: float = 20) -> dict[str, list[dict[str, Any]]]:
    data = mihomo_request("/providers/proxies", timeout=timeout) or {}
    result: dict[str, list[dict[str, Any]]] = {}
    for key, provider in (data.get("providers") or {}).items():
        if not str(key).startswith("routeva_"):
            continue
        nodes = []
        for proxy in provider.get("proxies") or []:
            key_name = str(proxy.get("name") or "").strip()
            if not key_name:
                continue
            prefix = f"[{key}] "
            display_name = key_name[len(prefix):] if key_name.startswith(prefix) else key_name
            nodes.append({
                "id": hashlib.sha256(f"{key}\0{key_name}".encode()).hexdigest()[:24],
                "key": key_name,
                "name": display_name,
                "protocol": str(proxy.get("type") or "proxy").lower(),
                "alive": proxy.get("alive"),
                "provider": key,
            })
        result[key] = nodes
    return result


def wait_for_provider(provider: str, timeout: float = 30) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        nodes = provider_snapshot().get(provider, [])
        if nodes:
            return nodes
        time.sleep(1)
    raise RuntimeError("Провайдер не вернул ни одного поддерживаемого узла")


def current_selection(account_id: str = "owner") -> str:
    group = account(account_id)["group"]
    try:
        data = mihomo_request("/proxies/" + urllib.parse.quote(group, safe="")) or {}
        return str(data.get("now") or "DIRECT")
    except Exception:
        return saved_selection(load_state(), account_id)


def build_public_status(wait_provider_id: str | None = None, account_id: str = "owner") -> dict[str, Any]:
    state = load_state()
    if wait_provider_id:
        wait_for_provider(wait_provider_id)
    providers = provider_snapshot()
    subscriptions = []
    all_nodes = []
    for item in state.get("subscriptions", []):
        provider = provider_id(item["id"])
        nodes = providers.get(provider, [])
        protocols = sorted({node["protocol"] for node in nodes})
        public = {
            "id": item["id"],
            "name": item["name"],
            "origin": item.get("origin", ""),
            "updatedAt": item.get("updatedAt"),
            "nodeCount": len(nodes),
            "protocols": protocols,
            "nodes": nodes,
        }
        subscriptions.append(public)
        all_nodes.extend({**node, "subscriptionId": item["id"]} for node in nodes)
    selected = current_selection(account_id)
    return {
        "version": 1,
        "capabilities": ["node-ping", "independent-selection"],
        "account": {"id": account_id, "role": account(account_id)["role"]},
        "ready": True,
        "selected": selected,
        "subscriptions": subscriptions,
        "nodes": all_nodes,
    }


def add_subscription(payload: dict[str, Any]) -> dict[str, Any]:
    url = validate_subscription_url(payload.get("url"))
    name = str(payload.get("name") or urllib.parse.urlsplit(url).hostname or "Подписка").strip()[:120]
    requested_id = str(payload.get("id") or uuid.uuid4().hex)
    subscription_id = requested_id
    if not subscription_id.replace("-", "").isalnum() or len(subscription_id) > 64:
        raise ValueError("Некорректный идентификатор подписки")
    with STATE_LOCK:
        before = load_state()
        existing = next((item for item in before["subscriptions"] if item["id"] == requested_id or item["url"] == url), None)
        if existing:
            subscription_id = existing["id"]
        item = {
            "id": subscription_id,
            "name": name,
            "url": url,
            "origin": urllib.parse.urlunsplit((*urllib.parse.urlsplit(url)[:2], "", "", "")),
            "updatedAt": utc_now(),
        }
        next_state = dict(before)
        next_state["subscriptions"] = [
            item if current["id"] == subscription_id else current
            for current in before["subscriptions"]
        ] if existing else [*before["subscriptions"], item]
        try:
            save_state(next_state)
            write_mihomo_config(next_state)
            restart_mihomo()
            return build_public_status(provider_id(subscription_id))
        except Exception:
            save_state(before)
            write_mihomo_config(before)
            restart_mihomo()
            raise


def delete_subscription(subscription_id: str) -> dict[str, Any]:
    with STATE_LOCK:
        state = load_state()
        subscriptions = [item for item in state["subscriptions"] if item["id"] != subscription_id]
        if len(subscriptions) == len(state["subscriptions"]):
            raise ValueError("Подписка не найдена")
        state["subscriptions"] = subscriptions
        if not subscriptions:
            state["selected"] = "DIRECT"
            state["selections"] = {key: "DIRECT" for key in state.get("selections", {})}
        save_state(state)
        write_mihomo_config(state)
        restart_mihomo()
        return build_public_status()


def refresh_subscription(subscription_id: str) -> dict[str, Any]:
    state = load_state()
    item = next((item for item in state["subscriptions"] if item["id"] == subscription_id), None)
    if not item:
        raise ValueError("Подписка не найдена")
    provider = provider_id(subscription_id)
    mihomo_request(f"/providers/proxies/{urllib.parse.quote(provider)}", method="PUT")
    item["updatedAt"] = utc_now()
    save_state(state)
    return build_public_status(provider)


def select_node(name: str, account_id: str = "owner") -> dict[str, Any]:
    identity = account(account_id)
    value = str(name or "").strip()
    status = build_public_status()
    allowed = {"DIRECT", *(node["key"] for node in status["nodes"])}
    if value not in allowed:
        matches = [node["key"] for node in status["nodes"] if node["name"] == value]
        if len(matches) > 1:
            raise ValueError("Несколько узлов имеют такое имя — выберите карточку заново")
        if not matches:
            raise ValueError("Узел не найден")
        value = matches[0]
    with STATE_LOCK:
        mihomo_request("/proxies/" + urllib.parse.quote(identity["group"], safe=""), method="PUT", payload={"name": value})
        state = load_state()
        if account_id == "owner":
            state["selected"] = value
        else:
            state.setdefault("selections", {})[account_id] = value
        save_state(state)
    # Keep switching constant-size. Returning every provider node here made
    # the browser download and rewrite hundreds of records after every click.
    return {
        "version": 1,
        "ready": True,
        "selected": value,
    }


def ping_node(node_id: Any) -> dict[str, Any]:
    """URL-test one known provider node, without selecting it or changing config.

    Caller cannot supply a URL, host, port or arbitrary controller path. Measurements
    start at this Gateway, not the extension user's PC. No subscription keys in results.
    """
    if not isinstance(node_id, str) or not re.fullmatch(r"[a-f0-9]{24}", node_id):
        raise ValueError("Некорректный идентификатор узла")
    result = {"id": node_id, "method": "gateway-proxy", "vantage": "gateway", "target": PING_TEST_URL}
    if not PING_SLOTS.acquire(blocking=False):
        return {**result, "status": "error", "delayMs": None, "code": "busy", "checkedAt": utc_now()}
    try:
        nodes = [node for group in provider_snapshot(timeout=3).values() for node in group]
        node = next((item for item in nodes if item["id"] == node_id), None)
        if node is None:
            raise ValueError("Узел не найден; обновите список серверов")
        name = urllib.parse.quote(node["key"], safe="")
        provider = urllib.parse.quote(node["provider"], safe="")
        query = urllib.parse.urlencode({"url": PING_TEST_URL, "timeout": PING_TIMEOUT_MS, "expected": "204"})
        # Provider nodes are not necessarily present in Mihomo's global proxy map.
        # Address the node inside its provider instead of reporting a false 404.
        response = mihomo_request(f"/providers/proxies/{provider}/{name}/healthcheck?{query}", timeout=8) or {}
        delay = response.get("delay") if isinstance(response, dict) else None
        # Mihomo exposes uint16 milliseconds and treats zero as a failed URL-test.
        if isinstance(delay, bool) or not isinstance(delay, int) or not 1 <= delay <= 60000:
            return {**result, "status": "error", "delayMs": None, "code": "invalid-response", "checkedAt": utc_now()}
        return {**result, "status": "ok", "delayMs": round(delay), "code": None, "checkedAt": utc_now()}
    except MihomoAPIError as error:
        code = "timeout" if error.status in (408, 504) else "unavailable"
        return {**result, "status": code, "delayMs": None, "code": code, "checkedAt": utc_now()}
    except (TimeoutError, socket.timeout):
        return {**result, "status": "timeout", "delayMs": None, "code": "timeout", "checkedAt": utc_now()}
    except json.JSONDecodeError:
        return {**result, "status": "error", "delayMs": None, "code": "invalid-response", "checkedAt": utc_now()}
    except (urllib.error.URLError, OSError, RuntimeError, AttributeError, TypeError):
        # Never forward raw controller errors: they may contain provider URLs/keys.
        return {**result, "status": "error", "delayMs": None, "code": "core-unavailable", "checkedAt": utc_now()}
    finally:
        PING_SLOTS.release()


class GatewayHandler(BaseHTTPRequestHandler):
    server_version = "RoutevaGateway/1"

    def setup(self) -> None:
        self.request.settimeout(20)
        super().setup()

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        self.account_id = None
        supplied = self.headers.get("Authorization", "").encode("utf-8")
        matched = None
        for account_id, identity in accounts().items():
            if not identity["username"] or not identity["password"]:
                continue
            expected = b"Basic " + base64.b64encode(f"{identity['username']}:{identity['password']}".encode())
            if hmac.compare_digest(supplied, expected):
                matched = account_id
        self.account_id = matched
        return matched is not None

    def require_auth(self) -> bool:
        if self.authorized():
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Routeva Gateway"')
        self.cors_headers()
        self.end_headers()
        return False

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Некорректный размер запроса")
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("Ожидался JSON-объект")
        return data

    def dispatch(self, method: str) -> Any:
        path = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
        if method == "GET" and path == "/v1/health":
            return {"ready": True, "service": "routeva-gateway", "version": 1, "appVersion": "0.9.2", "capabilities": ["node-ping", "independent-selection"]}
        if method == "GET" and path == "/v1/status":
            return build_public_status(account_id=self.account_id)
        if path.startswith("/v1/subscriptions") and method != "GET" and self.account_id != "owner":
            raise PermissionError("Подписками управляет владелец Gateway; вы можете выбирать и проверять серверы")
        if method == "POST" and path == "/v1/subscriptions":
            return add_subscription(self.read_json())
        if method == "PUT" and path == "/v1/nodes/select":
            return select_node(self.read_json().get("name"), account_id=self.account_id)
        if method == "POST" and path == "/v1/nodes/ping":
            return ping_node(self.read_json().get("id"))
        parts = path.split("/")
        if len(parts) == 4 and parts[1:3] == ["v1", "subscriptions"]:
            subscription_id = urllib.parse.unquote(parts[3])
            if method == "DELETE":
                return delete_subscription(subscription_id)
        if len(parts) == 5 and parts[1:3] == ["v1", "subscriptions"] and parts[4] == "refresh":
            subscription_id = urllib.parse.unquote(parts[3])
            if method == "PUT":
                return refresh_subscription(subscription_id)
        raise FileNotFoundError("Метод API не найден")

    def handle_method(self, method: str) -> None:
        if not self.require_auth():
            return
        try:
            self.send_json(200, self.dispatch(method))
        except FileNotFoundError as error:
            self.send_json(404, {"error": str(error)})
        except PermissionError as error:
            self.send_json(403, {"error": str(error)})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            self.send_json(502, {"error": str(error)[:500]})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self.handle_method("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.handle_method("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self.handle_method("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self.handle_method("DELETE")


class GatewayHTTPServer(ThreadingHTTPServer):
    """Keep incomplete TLS handshakes out of the shared accept loop."""

    request_queue_size = 64
    daemon_threads = True

    def __init__(self, address, handler, *, tls_context=None):
        self.tls_context = tls_context
        self.worker_slots = threading.BoundedSemaphore(64)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.worker_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.worker_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(5)
            if self.tls_context is not None:
                request = self.tls_context.wrap_socket(request, server_side=True)
            super().process_request_thread(request, client_address)
        except (OSError, ssl.SSLError):
            self.shutdown_request(request)
        finally:
            self.worker_slots.release()


def main() -> None:
    if not API_USERNAME or not API_PASSWORD or not MIHOMO_SECRET:
        raise SystemExit("ROUTEVA_API_USERNAME, ROUTEVA_API_PASSWORD and ROUTEVA_MIHOMO_SECRET are required")
    state = load_state()
    write_mihomo_config(state)
    context = None
    if TLS_CERT and TLS_KEY:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(TLS_CERT, TLS_KEY)
    elif LISTEN_HOST not in {"127.0.0.1", "::1"}:
        raise SystemExit("Public Routeva API requires TLS")
    server = GatewayHTTPServer((LISTEN_HOST, LISTEN_PORT), GatewayHandler, tls_context=context)
    print(f"Routeva Gateway listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
