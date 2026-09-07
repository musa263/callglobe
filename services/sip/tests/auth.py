"""Real AUTH/CHALLENGE routes against loopback HTTP failures; no credentials or calls."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket
import threading
import time
import uuid

PORT = 15062
HTTP_PORT = 18081


def auth_config(source):
    start = source.index('route[CHALLENGE] {')
    end = source.index('# What the edge decides', start)
    routes = source[start:end].replace('127.0.0.1:8081', f'127.0.0.1:{HTTP_PORT}')
    return '\n'.join([
        '#!KAMAILIO', 'debug=2', 'children=1', f'listen=udp:127.0.0.1:{PORT}',
        *[f'loadmodule "{name}.so"' for name in ['sl', 'pv', 'xlog', 'textops', 'siputils', 'jansson', 'http_client']],
        'modparam("http_client", "connection_timeout", 1)',
        '''route {
            if (is_method("OPTIONS")) { send_reply("200", "OK"); exit; }
            $var(auth_stale) = 0;
            $var(rtok) = "";
            if (!is_present_hf("Authorization")) { route(CHALLENGE); exit; }
            if (!route(AUTH)) { route(CHALLENGE); exit; }
            send_reply("200", "OK");
        }
        route[READ_ROUTE] { return; }
        ''', routes,
    ])


@contextmanager
def mock_auth():
    state = {'status': 200, 'body': '{"ok":true}', 'delay': 0, 'nonce_status': 200, 'nonce_body': '{"nonce":"1234567890.abcdefghijklmnopqrstuvwxyz"}', 'nonces': 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length', 0)))
            if self.path == '/sip-nonce':
                state['nonces'] += 1
                status, body, delay = state['nonce_status'], state['nonce_body'], 0
            else:
                status, body, delay = state['status'], state['body'], state['delay']
            time.sleep(delay)
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(body.encode())
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected when the SIP edge cancels a timed-out HTTP call.

    server = ThreadingHTTPServer(('127.0.0.1', HTTP_PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def exchange(method='REGISTER', *, authorized=True):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(('127.0.0.1', 0))
        sock.settimeout(3)
        identifier = uuid.uuid4().hex
        headers = [f'{method} sip:check SIP/2.0',
                   f'Via: SIP/2.0/UDP 127.0.0.1:{sock.getsockname()[1]};branch=z9hG4bK{identifier};rport',
                   'From: <sip:probe@check>;tag=probe', 'To: <sip:probe@check>',
                   f'Call-ID: {identifier}', f'CSeq: 1 {method}', 'Max-Forwards: 10']
        if authorized:
            headers.append('Authorization: Digest username="probe", realm="check", nonce="fixture", uri="sip:check", response="fixture"')
        sock.sendto(('\r\n'.join(headers + ['Content-Length: 0', '', ''])).encode(), ('127.0.0.1', PORT))
        return sock.recv(65536).decode()


def run_auth_probes(state):
    cases = [
        ('valid', 200, '{"ok":true}', 0, 200),
        ('password rejection', 403, '{"ok":false,"stale":false}', 0, 401),
        ('expired nonce', 403, '{"ok":false,"stale":true}', 0, 401),
        ('server failure', 500, '{"ok":false}', 0, 503),
        ('empty success', 200, '', 0, 503),
        ('malformed success', 200, '{broken', 0, 503),
        ('missing decision', 200, '{}', 0, 503),
        ('inconsistent success', 200, '{"ok":false}', 0, 503),
        ('inconsistent rejection', 403, '{"ok":true}', 0, 503),
        ('HTTP deadline / curl 28', 200, '{"ok":true}', 1.5, 503),
        ('recovery after timeout', 200, '{"ok":true}', 0, 200),
    ]
    for label, status, body, delay, expected in cases:
        state.update(status=status, body=body, delay=delay)
        before = state['nonces']
        reply = exchange()
        assert reply.startswith(f'SIP/2.0 {expected} '), (label, reply)
        challenged = 'WWW-Authenticate:' in reply
        assert challenged == (expected == 401), (label, reply)
        assert state['nonces'] - before == int(challenged), (label, 'unexpected nonce request')
        assert ('stale=true' in reply) == (label == 'expired nonce'), (label, reply)
        print(f'PASS auth {label}: {expected}', flush=True)
    for label, status, body, expected in [
        ('initial challenge', 200, '{"nonce":"1234567890.abcdefghijklmnopqrstuvwxyz"}', 401),
        ('nonce server failure', 500, '{}', 503),
        ('nonce malformed', 200, '{}', 503),
    ]:
        state.update(nonce_status=status, nonce_body=body)
        reply = exchange(authorized=False)
        assert reply.startswith(f'SIP/2.0 {expected} '), (label, reply)
        assert ('WWW-Authenticate:' in reply) == (expected == 401), (label, reply)
        print(f'PASS auth {label}: {expected}', flush=True)
