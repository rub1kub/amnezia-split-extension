import unittest
import json
import base64
import threading
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock

from gateway import routeva_gateway as gateway


class GatewayConfigTests(unittest.TestCase):
    def test_provider_id_is_stable_and_safe(self):
        self.assertEqual(gateway.provider_id("Sub-123"), "routeva_sub123")
        self.assertEqual(gateway.provider_prefix("Sub-123"), "[routeva_sub123] ")

    def test_config_keeps_tunnel_ports_on_loopback(self):
        old_secret = gateway.MIHOMO_SECRET
        gateway.MIHOMO_SECRET = "test-secret"
        try:
            config = gateway.render_mihomo_config({
                "subscriptions": [{
                    "id": "sub-1",
                    "name": "Test",
                    "url": "https://provider.example/private?first=one&mode=two",
                }]
            })
        finally:
            gateway.MIHOMO_SECRET = old_secret
        self.assertIn("bind-address: 127.0.0.1", config)
        self.assertIn("external-controller: 127.0.0.1:18448", config)
        self.assertIn("mixed-port: 18447", config)
        self.assertIn('url: "https://provider.example/private?first=one&mode=two"', config)
        self.assertIn('additional-prefix: "[routeva_sub1] "', config)
        self.assertIn("- DIRECT", config)
        self.assertNotIn("0.0.0.0:18448", config)

    def test_rejects_non_https_subscription_before_network_access(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            gateway.validate_subscription_url("http://provider.example/sub")

    @mock.patch.object(gateway, "mihomo_request")
    def test_provider_snapshot_exposes_safe_key_and_clean_name(self, request):
        request.return_value = {
            "providers": {
                "routeva_sub1": {
                    "proxies": [{
                        "name": "[routeva_sub1] Berlin",
                        "type": "VLESS",
                        "alive": True,
                    }]
                }
            }
        }
        node = gateway.provider_snapshot()["routeva_sub1"][0]
        self.assertEqual(node["key"], "[routeva_sub1] Berlin")
        self.assertEqual(node["name"], "Berlin")
        self.assertEqual(node["protocol"], "vless")

    @mock.patch.object(gateway, "build_public_status")
    def test_duplicate_display_name_requires_card_key(self, status):
        status.return_value = {
            "nodes": [
                {"key": "[routeva_one] Auto", "name": "Auto"},
                {"key": "[routeva_two] Auto", "name": "Auto"},
            ]
        }
        with self.assertRaisesRegex(ValueError, "Несколько узлов"):
            gateway.select_node("Auto")

    @mock.patch.object(gateway, "save_state")
    @mock.patch.object(gateway, "load_state")
    @mock.patch.object(gateway, "mihomo_request")
    @mock.patch.object(gateway, "build_public_status")
    def test_selection_response_does_not_return_every_node(self, status, request, load_state, save_state):
        status.return_value = {
            "nodes": [{"key": "[routeva_one] Berlin", "name": "Berlin"}]
        }
        load_state.return_value = {"selected": "DIRECT", "subscriptions": []}

        result = gateway.select_node("[routeva_one] Berlin")

        request.assert_called_once_with(
            "/proxies/ROUTEVA",
            method="PUT",
            payload={"name": "[routeva_one] Berlin"},
        )
        save_state.assert_called_once()
        self.assertEqual(result["selected"], "[routeva_one] Berlin")
        self.assertNotIn("nodes", result)


class GatewayPingTests(unittest.TestCase):
    node_id = "a" * 24
    node = {"id": node_id, "key": "[routeva_test] Berlin / ?#", "name": "Berlin", "provider": "routeva_test"}

    def setUp(self):
        self.snapshot = mock.patch.object(gateway, "provider_snapshot", return_value={"routeva_test": [self.node]}).start()
        self.request = mock.patch.object(gateway, "mihomo_request", return_value={"delay": 73}).start()
        self.save = mock.patch.object(gateway, "save_state").start()
        self.restart = mock.patch.object(gateway, "restart_mihomo").start()
        self.addCleanup(mock.patch.stopall)

    def test_fixed_url_encoded_node_and_no_selection_or_config_writes(self):
        result = gateway.ping_node(self.node_id)
        self.assertEqual(result["delayMs"], 73)
        self.assertEqual(result["vantage"], "gateway")
        self.assertEqual(result["status"], "ok")
        path = self.request.call_args.args[0]
        self.assertTrue(path.startswith("/providers/proxies/routeva_test/%5Brouteva_test%5D%20Berlin%20%2F%20%3F%23/healthcheck?"))
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
        self.assertEqual(query["url"], [gateway.PING_TEST_URL])
        self.assertEqual(query["timeout"], ["6000"])
        self.assertEqual(query["expected"], ["204"])
        self.assertEqual(self.request.call_args.kwargs, {"timeout": 8})
        self.save.assert_not_called()
        self.restart.assert_not_called()
        self.assertNotIn("key", result)

    def test_provider_node_is_tested_when_global_proxy_map_returns_404(self):
        def core(path, **kwargs):
            if path.startswith('/proxies/'):
                raise gateway.MihomoAPIError(404, 'Global proxy not found')
            self.assertIn('/providers/proxies/routeva_test/', path)
            return {"delay": 91}
        self.request.side_effect = core
        self.assertEqual(gateway.ping_node(self.node_id)["delayMs"], 91)

    def test_invalid_or_unknown_id_never_reaches_core_url_test(self):
        for value in [None, [], "http://localhost", "../../proxies", "a" * 23]:
            with self.assertRaises(ValueError):
                gateway.ping_node(value)
        with self.assertRaises(ValueError):
            gateway.ping_node("b" * 24)
        self.request.assert_not_called()

    def test_bad_measurements_not_converted_to_zero(self):
        for response in [{}, {"delay": None}, {"delay": False}, {"delay": 0}, {"delay": 0.4}, {"delay": -1}, {"delay": float("nan")}, {"delay": 60001}, {"delay": "0"}, [123]]:
            self.request.return_value = response
            result = gateway.ping_node(self.node_id)
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["code"], "invalid-response")
            self.assertIsNone(result["delayMs"])

    def test_timeouts_and_errors_are_safe_and_release_slots(self):
        for exception, expected in [(TimeoutError(), "timeout"), (gateway.MihomoAPIError(504, "secret"), "timeout"), (gateway.MihomoAPIError(500, "secret"), "unavailable"), (RuntimeError("private subscription token"), "error")]:
            self.request.side_effect = exception
            result = gateway.ping_node(self.node_id)
            self.assertEqual(result["status"], expected)
            self.assertNotIn("secret", json.dumps(result))
            self.assertNotIn("private", json.dumps(result))
        self.request.side_effect = None
        self.assertEqual(gateway.ping_node(self.node_id)["status"], "ok")

    def test_core_snapshot_error_is_not_forwarded(self):
        self.snapshot.side_effect = RuntimeError("private provider URL")
        result = gateway.ping_node(self.node_id)
        self.assertEqual(result["code"], "core-unavailable")
        self.assertNotIn("private", json.dumps(result))

    def test_busy_queue_does_not_make_network_requests(self):
        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with mock.patch.object(gateway, "PING_SLOTS", slots):
            self.assertEqual(gateway.ping_node(self.node_id)["code"], "busy")
        slots.release()
        self.snapshot.assert_not_called()
        self.request.assert_not_called()

    def test_http_auth_dispatch_and_fixed_target(self):
        server = gateway.ThreadingHTTPServer(("127.0.0.1", 0), gateway.GatewayHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1/nodes/ping"
        body = json.dumps({"id": self.node_id, "url": "http://127.0.0.1/private"}).encode()
        try:
            with mock.patch.object(gateway, "API_USERNAME", "test"), mock.patch.object(gateway, "API_PASSWORD", "test-only"):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=3)
                self.assertEqual(error.exception.code, 401)
                self.request.assert_not_called()
                headers = {"Authorization": "Basic " + base64.b64encode(b"test:test-only").decode(), "Content-Type": "application/json"}
                with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=3) as response:
                    result = json.load(response)
                self.assertEqual(result["status"], "ok")
                self.assertEqual(result["target"], gateway.PING_TEST_URL)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
