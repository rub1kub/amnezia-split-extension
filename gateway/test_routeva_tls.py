import concurrent.futures
import datetime
import ipaddress
import pathlib
import socket
import ssl
import tempfile
import threading
import time
import unittest
import urllib.request

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from gateway import routeva_gateway as gateway


class Handler(gateway.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'healthy')

    def log_message(self, *args):
        pass


class TLSConcurrencyTests(unittest.TestCase):
    def test_incomplete_tls_connection_does_not_delay_other_clients(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-datetime.timedelta(minutes=1))
                .not_valid_after(now+datetime.timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), False)
                .sign(key, hashes.SHA256()))
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            (root/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            ctx.load_cert_chain(root/'cert.pem',root/'key.pem')
            client_ctx = ssl.create_default_context(cafile=str(root/'cert.pem'))
            server = gateway.GatewayHTTPServer(('127.0.0.1',0), Handler, tls_context=ctx)
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            held = [socket.create_connection(server.server_address) for _ in range(3)]
            try:
                time.sleep(.1)
                start = time.monotonic()
                def request(_):
                    with urllib.request.urlopen('https://127.0.0.1:'+str(server.server_port), context=client_ctx,timeout=1.5) as response:
                        return response.read()
                with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                    self.assertEqual(list(pool.map(request,range(6))),[b'healthy']*6)
                self.assertLess(time.monotonic()-start,1.5)
            finally:
                for sock in held:sock.close()
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
