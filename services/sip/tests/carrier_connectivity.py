"""Bounded SIP OPTIONS probes; never registers, invites, or changes a PBX."""
import argparse
import ipaddress
import json
import re
import socket
import time
import uuid


def probe(address, port, expected_public_ip, timeout=3):
    ipaddress.IPv4Address(address)
    ipaddress.IPv4Address(expected_public_ip)
    if not 1 <= port <= 65535:
        raise ValueError('Invalid SIP port')
    report = {'target': f'{address}:{port}', 'method': 'OPTIONS', 'attempts': 0}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect((address, port))
        source_ip, source_port = sock.getsockname()
        report.update(source_ip=source_ip, expected_public_ip=expected_public_ip,
                      source_matches_expected=source_ip == expected_public_ip)
        call_id = str(uuid.uuid4())
        packet = '\r\n'.join([
            f'OPTIONS sip:{address}:{port} SIP/2.0',
            f'Via: SIP/2.0/UDP {source_ip}:{source_port};branch=z9hG4bK{uuid.uuid4().hex};rport',
            'Max-Forwards: 10',
            f'From: <sip:connectivity-check@{source_ip}>;tag={uuid.uuid4().hex}',
            f'To: <sip:{address}>', f'Call-ID: {call_id}', 'CSeq: 1 OPTIONS',
            f'Contact: <sip:connectivity-check@{source_ip}:{source_port}>',
            'User-Agent: Vocivo-Connectivity-Check', 'Content-Length: 0', '', '',
        ]).encode('ascii')
        for attempt in range(2):
            report['attempts'] = attempt + 1
            deadline = time.monotonic() + timeout
            try:
                sock.send(packet)
                while time.monotonic() < deadline:
                    sock.settimeout(max(0.01, deadline - time.monotonic()))
                    body = sock.recv(8192).decode('utf-8', errors='replace')
                    if not re.search(r'^Call-ID:\s*' + re.escape(call_id) + r'\s*$', body, re.M | re.I):
                        continue
                    match = re.match(r'SIP/2.0 (\d{3})(?: ([^\r\n]*))?', body)
                    if match:
                        report.update(result='sip_response', status=int(match[1]))
                        return report
            except socket.timeout:
                pass  # A second bounded retransmission distinguishes transient loss.
            except OSError as error:
                report.update(result='socket_error', error=type(error).__name__, errno=error.errno)
                return report
        report['result'] = 'no_response'
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('carrier_ip')
    parser.add_argument('carrier_port', type=int)
    parser.add_argument('expected_public_ip')
    args = parser.parse_args()
    for target in dict.fromkeys([args.carrier_ip, args.expected_public_ip]):
        print(json.dumps(probe(target, args.carrier_port, args.expected_public_ip)), flush=True)
    print('OPTIONS reachability is not proof of call authorization or two-way audio.', flush=True)
