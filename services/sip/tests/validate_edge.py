#!/usr/bin/env python3
"""Linux/Docker gate: full config parse, then isolated ingress packet tests.

The probe listener uses production ingress through OPTIONS, with no downstream
routes. It cannot authenticate, register contacts, or originate a call.
"""
import base64
import hashlib
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import uuid
from delivery import PORT as DELIVERY_PORT, Peer, delivery_config, run_delivery_probes
from auth import auth_config, exchange as auth_exchange, mock_auth, run_auth_probes

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, **kwargs):
    return subprocess.run(['docker', *map(str, args)], check=True, **kwargs)


def ingress_config(source):
    # Fail closed if the production boundary changes; never copy downstream
    # auth, media, or call routing into the packet-test listener.
    start = source.index('event_route[xhttp:request] {')
    end = source.index('    # Every X-Vocivo header', start)
    ingress = source[start:end]
    if ingress.count('route {') != 1 or 'sl_send_reply("200", "OK")' not in ingress:
        raise ValueError('Production ingress boundary changed')
    modules = ['sl', 'pv', 'xlog', 'maxfwd', 'sanity', 'textops',
               'siputils', 'xhttp', 'websocket']
    return '\n'.join([
        '#!KAMAILIO', 'debug=2', 'children=1', 'tcp_children=1',
        'tcp_accept_no_cl=yes', 'listen=udp:127.0.0.1:15060',
        'listen=tcp:127.0.0.1:15060', 'listen=tcp:127.0.0.1:8080',
        *[f'loadmodule "{name}.so"' for name in modules],
        'modparam("sanity", "autodrop", 0)',
        'modparam("websocket", "cors_mode", 2)',
        ingress, '    exit;', '}',
    ])


def exact(sock, length):
    result = b''
    while len(result) < length:
        chunk = sock.recv(length - len(result))
        if not chunk:
            raise ConnectionError('Peer closed the connection')
        result += chunk
    return result


def websocket(sock):
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f'GET /ws HTTP/1.1\r\nHost: localhost:8080\r\n'
                  f'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                  f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n'
                  'Sec-WebSocket-Protocol: sip\r\nOrigin: http://localhost\r\n\r\n').encode())
    response = b''
    while not response.endswith(b'\r\n\r\n'):
        response += exact(sock, 1)
        if len(response) > 16384:
            raise ValueError('Oversized handshake')
    expected = base64.b64encode(hashlib.sha1(
        (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
    assert response.startswith(b'HTTP/1.1 101 '), response
    assert expected in response, response


def exchange(transport, change=None):
    kind = socket.SOCK_DGRAM if transport == 'UDP' else socket.SOCK_STREAM
    with socket.socket(socket.AF_INET, kind) as sock:
        sock.settimeout(2)
        sock.connect(('127.0.0.1', 8080 if transport == 'WS' else 15060))
        if transport == 'WS':
            websocket(sock)
        identifier = uuid.uuid4().hex
        headers = {
            'Via': f'SIP/2.0/{transport} 127.0.0.1:{sock.getsockname()[1]};branch=z9hG4bK{identifier};rport',
            'From': '<sip:probe@localhost>;tag=probe', 'To': '<sip:edge@localhost>',
            'Call-ID': identifier, 'CSeq': '1 OPTIONS', 'Max-Forwards': '10',
            'Content-Length': '0',
        }
        if change:
            name, value = change
            if value is None:
                headers.pop(name)
            else:
                headers[name] = value
        payload = ('OPTIONS sip:edge@localhost SIP/2.0\r\n' + ''.join(
            f'{name}: {value}\r\n' for name, value in headers.items()) + '\r\n').encode()
        if transport == 'WS':
            mask = os.urandom(4)
            length = len(payload)
            frame = bytes([0x81, 0x80 | 126]) + struct.pack('!H', length) + mask
            sock.sendall(frame + bytes(value ^ mask[i % 4] for i, value in enumerate(payload)))
            first, second = exact(sock, 2)
            assert first == 0x81 and not second & 0x80, 'Unexpected server WebSocket frame'
            length = second & 127
            if length == 126:
                length = struct.unpack('!H', exact(sock, 2))[0]
            elif length == 127:
                length = struct.unpack('!Q', exact(sock, 8))[0]
            assert length <= 65536, 'Oversized SIP response'
            response = exact(sock, length)
        else:
            sock.sendall(payload)
            response = sock.recv(65536)
            while transport == 'TCP' and b'\r\n\r\n' not in response:
                response += exact(sock, 1)
        match = re.match(rb'SIP/2.0 (\d{3}) ', response)
        assert match, response
        return int(match[1])


def run_probes():
    count = 0
    for transport in ['UDP', 'TCP', 'WS']:
        cases = [('valid', None, {200}),
                 ('CSeq method mismatch', ('CSeq', '1 INVITE'), {400}),
                 ('invalid CSeq', ('CSeq', 'abc OPTIONS'), {400}),
                 ('hop limit', ('Max-Forwards', '0'), {483})]
        # A malformed request may be dropped when required response-routing
        # headers are missing. The healthy baseline above prevents a dead
        # listener from making a missing-header test pass.
        cases += [(f'missing {name}', (name, None), {400, None})
                  for name in ['Via', 'From', 'To', 'Call-ID', 'CSeq']]
        if transport != 'TCP':
            # TCP uses Content-Length for framing before the script runs.
            cases.append(('length compatibility', ('Content-Length', '1'),
                          {200} if transport == 'WS' else {400}))
        for label, change, expected in cases:
            try:
                status = exchange(transport, change)
            except (socket.timeout, ConnectionError):
                status = None
            assert status in expected, f'{transport}: {label}: got {status}, expected {expected}'
            count += 1
            print(f'PASS {transport}: {label} -> {status or "dropped"}', flush=True)
        assert exchange(transport) == 200, f'{transport} listener stopped responding'
    print(f'{count} ingress packet cases passed', flush=True)


def main():
    if not shutil.which('docker'):
        raise SystemExit('Docker is required. Run this gate on Linux or in GitHub Actions.')
    image = re.search(r'image:\s*(ghcr.io/kamailio/\S+)',
                      (ROOT / 'docker-compose.yml').read_text()).group(1)
    docker('pull', image)
    args = ['run', '--rm', '--network', 'none']
    for local, target in [('kamailio.cfg', '/etc/kamailio/kamailio.cfg'),
                          ('dispatcher.list', '/etc/kamailio/dispatcher.list'),
                          ('docker-entrypoint.sh', '/entrypoint.sh')]:
        args += ['-v', f'{ROOT / "kamailio" / local}:{target}:ro']
    for value in ['KAMAILIO_CHECK_ONLY=1', 'VOCIVO_SIP_REALM=check',
                  'SIP_EDGE_SECRET=check', 'VOCIVO_API_URL=http://127.0.0.1',
                  'PUBLIC_IP=198.51.100.1', 'VOCIVO_TRUNK_SOURCES=192.0.2.0/24,192.0.2.1']:
        args += ['-e', value]
    docker(*args, '--entrypoint', '/bin/sh', image, '/entrypoint.sh')
    with tempfile.TemporaryDirectory(prefix='sip-ingress-') as directory:
        config = Path(directory) / 'ingress.cfg'
        config.write_text(ingress_config((ROOT / 'kamailio/kamailio.cfg').read_text()))
        name = 'sip-validation-' + uuid.uuid4().hex[:12]
        try:
            docker('run', '-d', '--name', name, '--network', 'host',
                   '-v', f'{config}:/etc/kamailio/ingress.cfg:ro',
                   '--entrypoint', 'kamailio', image, '-DD', '-E',
                   '-f', '/etc/kamailio/ingress.cfg')
            for attempt in range(40):
                try:
                    if exchange('UDP') == 200:
                        break
                except (OSError, AssertionError):
                    time.sleep(0.25)
            else:
                raise RuntimeError('Isolated Kamailio listener did not become ready')
            run_probes()
        finally:
            subprocess.run(['docker', 'logs', name], check=False)
            subprocess.run(['docker', 'rm', '-f', name], check=False)
    with mock_auth() as state, tempfile.TemporaryDirectory(prefix='sip-auth-') as directory:
        config = Path(directory) / 'auth.cfg'
        config.write_text(auth_config((ROOT / 'kamailio/kamailio.cfg').read_text()))
        name = 'sip-auth-' + uuid.uuid4().hex[:12]
        try:
            docker('run', '-d', '--name', name, '--network', 'host',
                   '-e', 'VOCIVO_SIP_REALM=check',
                   '-v', f'{config}:/etc/kamailio/auth.cfg:ro',
                   '--entrypoint', 'kamailio', image, '-DD', '-E', '-f', '/etc/kamailio/auth.cfg')
            for attempt in range(20):
                try:
                    if auth_exchange('OPTIONS').startswith('SIP/2.0 200 '):
                        break
                except OSError:
                    time.sleep(0.25)
            else:
                raise RuntimeError('Isolated auth listener did not become ready')
            run_auth_probes(state)
        finally:
            subprocess.run(['docker', 'logs', name], check=False)
            subprocess.run(['docker', 'rm', '-f', name], check=False)
    # Unlike ingress checks, these exchanges exercise actual TM/TSILO contact
    # delivery and answers. First prove the old suspended algorithm loses 180.
    for baseline in [True, False]:
        with tempfile.TemporaryDirectory(prefix='sip-delivery-') as directory:
            config = Path(directory) / 'delivery.cfg'
            config.write_text(delivery_config((ROOT / 'kamailio/kamailio.cfg').read_text(),
                                              suspended_baseline=baseline))
            name = 'sip-delivery-' + uuid.uuid4().hex[:12]
            try:
                docker('run', '-d', '--name', name, '--network', 'host',
                       '-e', 'VOCIVO_SIP_REALM=check',
                       '-v', f'{config}:/etc/kamailio/delivery.cfg:ro',
                       '--entrypoint', 'kamailio', image, '-DD', '-E',
                       '-f', '/etc/kamailio/delivery.cfg')
                for attempt in range(20):
                    probe = Peer()
                    try:
                        probe.request('OPTIONS', f'sip:check@127.0.0.1:{DELIVERY_PORT}')
                        probe.response('OPTIONS', 200, timeout=0.25)
                        break
                    except (OSError, AssertionError):
                        time.sleep(0.25)
                    finally:
                        probe.close()
                else:
                    raise RuntimeError('Isolated delivery listener did not become ready')
                run_delivery_probes(suspended_baseline=baseline)
            finally:
                subprocess.run(['docker', 'logs', name], check=False)
                subprocess.run(['docker', 'rm', '-f', name], check=False)


if __name__ == '__main__':
    main()
