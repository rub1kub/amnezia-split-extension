import unittest
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


if __name__ == "__main__":
    unittest.main()
