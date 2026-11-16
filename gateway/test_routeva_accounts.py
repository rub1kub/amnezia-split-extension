import base64
import concurrent.futures
import copy
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from gateway import routeva_gateway as gateway


class AccountIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.account_file = pathlib.Path(self.temp.name) / 'accounts.json'
        self.account_file.write_text(json.dumps({'users': [{'id': 'friend', 'username': 'routeva-friend', 'password': 'friend-test-secret', 'proxy_port': 18453}]}))
        self.state_file = pathlib.Path(self.temp.name) / 'state.json'
        self.state_file.write_text(json.dumps({'version': 1, 'subscriptions': [], 'selected': 'DIRECT', 'selections': {'friend': 'DIRECT'}}))
        for key, value in {'ACCOUNTS_PATH': self.account_file, 'DATA_DIR': pathlib.Path(self.temp.name), 'STATE_PATH': self.state_file, 'API_USERNAME': 'owner-login', 'API_PASSWORD': 'owner-test-secret'}.items():
            patch = mock.patch.object(gateway, key, value); patch.start(); self.addCleanup(patch.stop)
        self.choices = {'ROUTEVA': 'DIRECT', 'ROUTEVA_FRIEND': 'DIRECT'}
        self.nodes = [{'key': 'node-A', 'name': 'A'}, {'key': 'node-B', 'name': 'B'}]
        def core(path, method='GET', payload=None, **kwargs):
            group = path.rsplit('/', 1)[-1]
            if path.startswith('/proxies/'):
                if method == 'PUT': self.choices[group] = payload['name']; return None
                return {'now': self.choices[group]}
            if path == '/providers/proxies': return {'providers': {}}
            raise AssertionError(path)
        patch=mock.patch.object(gateway, 'mihomo_request', side_effect=core); self.core=patch.start(); self.addCleanup(patch.stop)

    def select(self, node, account):
        with mock.patch.object(gateway, 'build_public_status', return_value={'nodes': self.nodes}):
            return gateway.select_node(node, account)

    def test_selection_and_persistence_are_independent_in_both_directions(self):
        self.select('node-A', 'friend')
        self.assertEqual(self.choices, {'ROUTEVA': 'DIRECT', 'ROUTEVA_FRIEND': 'node-A'})
        self.select('node-B', 'owner')
        self.assertEqual(self.choices, {'ROUTEVA': 'node-B', 'ROUTEVA_FRIEND': 'node-A'})
        state = gateway.load_state()
        self.assertEqual(state['selected'], 'node-B')
        self.assertEqual(state['selections']['friend'], 'node-A')
        self.assertEqual(gateway.current_selection('friend'), 'node-A')
        self.assertEqual(gateway.current_selection('owner'), 'node-B')

    def test_concurrent_selections_do_not_lose_the_other_accounts_state(self):
        with mock.patch.object(gateway, 'build_public_status', return_value={'nodes': self.nodes}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=[pool.submit(gateway.select_node, 'node-A', 'owner'), pool.submit(gateway.select_node, 'node-B', 'friend')]
                for result in results: result.result()
        self.assertEqual(gateway.load_state()['selected'], 'node-A')
        self.assertEqual(gateway.load_state()['selections']['friend'], 'node-B')

    def test_tls_listeners_have_distinct_credentials_ports_and_forced_groups(self):
        config=gateway.render_mihomo_config(gateway.load_state())
        owner=config.split('  - name: routeva-owner\n')[1].split('  - name: routeva-friend\n')[0]
        friend=config.split('  - name: routeva-friend\n')[1].split('profile:')[0]
        self.assertIn('port: 18443', owner); self.assertIn('proxy: "ROUTEVA"', owner)
        self.assertIn('owner-test-secret', owner); self.assertNotIn('friend-test-secret', owner)
        self.assertIn('port: 18453', friend); self.assertIn('proxy: "ROUTEVA_FRIEND"', friend)
        self.assertIn('friend-test-secret', friend); self.assertNotIn('owner-test-secret', friend)

    def test_unknown_account_and_duplicate_ports_are_rejected(self):
        with self.assertRaises(PermissionError): self.select('node-A', 'owner-from-body')
        data=json.loads(self.account_file.read_text());data['users'][0]['proxy_port']=18443
        self.account_file.write_text(json.dumps(data))
        with self.assertRaises(ValueError): gateway.accounts()

    def test_http_auth_scopes_selection_and_forbids_subscription_mutations(self):
        server=gateway.ThreadingHTTPServer(('127.0.0.1',0),gateway.GatewayHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(path, method='GET', body=None, user='routeva-friend', password='friend-test-secret', origin='chrome-extension://'+'b'*32):
            headers={'Authorization':'Basic '+base64.b64encode((user+':'+password).encode()).decode(),'Origin':origin,'Content-Type':'application/json'}
            return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=3)
        try:
            with request('/v1/status') as response:
                status=json.load(response);self.assertEqual(status['account']['id'],'friend');self.assertEqual(response.headers['Access-Control-Allow-Origin'],'chrome-extension://'+'b'*32)
                self.assertNotIn('password',json.dumps(status))
            with mock.patch.object(gateway,'build_public_status',return_value={'nodes':self.nodes}):
                with request('/v1/nodes/select','PUT',{'name':'node-A','account_id':'owner'}) as response: self.assertEqual(json.load(response)['selected'],'node-A')
            self.assertEqual(self.choices['ROUTEVA'],'DIRECT');self.assertEqual(self.choices['ROUTEVA_FRIEND'],'node-A')
            for path,method,body in [('/v1/subscriptions','POST',{'url':'https://example.org'}),('/v1/subscriptions/test','DELETE',None),('/v1/subscriptions/test/refresh','PUT',{})]:
                with self.assertRaises(urllib.error.HTTPError) as error:request(path,method,body)
                self.assertEqual(error.exception.code,403)
            with self.assertRaises(urllib.error.HTTPError) as error:request('/v1/status',password='wrong')
            self.assertEqual(error.exception.code,401)
            with request('/v1/status',user='owner-login',password='owner-test-secret') as response:self.assertEqual(json.load(response)['account']['id'],'owner')
            with request('/v1/health',origin='https://untrusted.example') as response:self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
        finally:
            server.shutdown();server.server_close();thread.join(timeout=3)


if __name__=='__main__': unittest.main()
