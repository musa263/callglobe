"""Run in a Python container sharing the isolated FreeSWITCH network namespace.

Uses only loopback SIP peers and the production generated outbound XML. Validates
selected carrier, caller ID, actual media bridging, capacity and no fallback.
"""
import json
import re
import select
import socket
import struct
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

FIXTURE = json.load(open('/fixtures/routes.json'))
ROUTES = FIXTURE['routes']
COUNTS = [0, 0]
ERRORS = []
MEDIA = [0, 0]
READY = [threading.Event(), threading.Event()]


class Api(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
        xml = FIXTURE['unavailable']
        for route in ROUTES:
            if body.get('variable_sip_h_X-Vocivo-Route-Token') == [route['token']] and body.get('Caller-Destination-Number') == [route['destination']]:
                xml = route['xml']
        self.send_response(200)
        self.send_header('Content-Type', 'text/xml')
        self.send_header('Content-Length', str(len(xml.encode())))
        self.end_headers()
        self.wfile.write(xml.encode())


def headers(msg):
    return {line.split(':', 1)[0].lower(): line.split(':', 1)[1].strip()
            for line in msg.split('\r\n\r\n')[0].split('\r\n')[1:] if ':' in line}


def response(msg, status='200 OK', body='', contact='', tag=''):
    h = headers(msg)
    fields = [f'{name}: {h[name.lower()]}' for name in ['Via', 'From', 'Call-ID', 'CSeq']]
    fields.append('To: ' + h['to'] + tag)
    if body:
        fields += ['Content-Type: application/sdp', f'Contact: <{contact}>']
    return f'SIP/2.0 {status}\r\n' + '\r\n'.join(fields) + f'\r\nContent-Length: {len(body)}\r\n\r\n' + body


def sdp(port):
    return f'v=0\r\no=test 1 1 IN IP4 127.0.0.1\r\ns=local\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio {port} RTP/AVP 8\r\na=rtpmap:8 PCMA/8000\r\na=ptime:20\r\na=sendrecv\r\n'


def carrier(index):
    sip = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sip.bind(('127.0.0.1', 15080 + index))
    rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rtp.bind(('127.0.0.1', 15180 + index))
    calls = set()
    while True:
        for ready in select.select([sip, rtp], [], [], 1)[0]:
            raw, addr = ready.recvfrom(65536)
            if ready is rtp:
                MEDIA[index] += 1
                rtp.sendto(raw, addr)
                continue
            msg = raw.decode()
            if msg.startswith('INVITE '):
                h = headers(msg)
                if h['call-id'] not in calls:
                    calls.add(h['call-id'])
                    COUNTS[index] += 1
                    if not msg.startswith(f'INVITE sip:{ROUTES[index]["destination"]}@'):
                        ERRORS.append('Wrong gateway destination')
                    if ROUTES[index]['callerId'] not in h['from']:
                        ERRORS.append('Wrong tenant caller ID')
                body = sdp(15180 + index)
                sip.sendto(response(msg, body=body, contact=f'sip:carrier@127.0.0.1:{15080 + index}', tag=';tag=carrier').encode(), addr)
            elif msg.startswith(('OPTIONS ', 'BYE ', 'CANCEL ')):
                sip.sendto(response(msg).encode(), addr)
                if msg.startswith('OPTIONS '):
                    READY[index].set()


class Caller:
    def __init__(self, index, invalid=False):
        self.sip = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sip.bind(('127.0.0.1', 0))
        self.sip.settimeout(8)
        self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.rtp.bind(('127.0.0.1', 0))
        self.port = self.sip.getsockname()[1]
        self.cid = uuid.uuid4().hex
        route = ROUTES[index]
        target = f'sip:{route["destination"]}@127.0.0.1:15060'
        self.base = f'Via: SIP/2.0/UDP 127.0.0.1:{self.port};branch=z9hG4bK{self.cid}\r\nMax-Forwards: 70\r\nFrom: <sip:caller@127.0.0.1>;tag=caller{self.cid}\r\nTo: <{target}>\r\nCall-ID: {self.cid}\r\nContact: <sip:caller@127.0.0.1:{self.port}>\r\n'
        token = 'invalid' if invalid else route['token']
        body = sdp(self.rtp.getsockname()[1])
        msg = f'INVITE {target} SIP/2.0\r\n{self.base}CSeq: 1 INVITE\r\nX-Vocivo-Flow: outbound\r\nX-Vocivo-Caller-ID: {route["callerId"]}\r\nX-Vocivo-Route-Token: {token}\r\nContent-Type: application/sdp\r\nContent-Length: {len(body)}\r\n\r\n{body}'
        self.sip.sendto(msg.encode(), ('127.0.0.1', 15060))
        while True:
            reply = self.sip.recv(65536).decode()
            self.code = int(reply.split()[1])
            if self.code >= 200:
                self.h = headers(reply)
                self.target = re.search(r'<([^>]+)>', self.h.get('contact', f'<{target}>')).group(1)
                self.send('ACK', 1)
                if self.code == 200:
                    self.media = ('127.0.0.1', int(re.search(r'm=audio (\d+)', reply).group(1)))
                break

    def send(self, method, seq):
        msg = f'{method} {self.target} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{self.port};branch=z9hG4bK{uuid.uuid4().hex}\r\nMax-Forwards: 70\r\nFrom: {self.h["from"]}\r\nTo: {self.h["to"]}\r\nCall-ID: {self.cid}\r\nCSeq: {seq} {method}\r\nContent-Length: 0\r\n\r\n'
        self.sip.sendto(msg.encode(), ('127.0.0.1', 15060))

    def audio(self):
        received = 0
        for seq in range(100):
            self.rtp.sendto(struct.pack('!BBHII', 0x80, 8, seq, seq * 160, 12345) + b'\xd5' * 160, self.media)
            for ready in select.select([self.rtp], [], [], .02)[0]:
                packet = ready.recv(2048)
                received += packet[12:] == b'\xd5' * 160
        return received

    def close(self):
        if self.code == 200:
            self.send('BYE', 2)
        self.sip.close()
        self.rtp.close()


threading.Thread(target=HTTPServer(('127.0.0.1', 18881), Api).serve_forever, daemon=True).start()
for index in [0, 1]:
    threading.Thread(target=carrier, args=(index,), daemon=True).start()
for event in READY:
    assert event.wait(40), 'Simulated carrier received no gateway OPTIONS'
time.sleep(.2)
a = Caller(0)
assert a.code == 200, ('first carrier failed', a.code)
blocked = Caller(0)
assert blocked.code >= 400, ('capacity not enforced', blocked.code)
b = Caller(1)
assert b.code == 200, ('other tenant blocked', b.code)
invalid = Caller(1, invalid=True)
assert invalid.code == 503, ('invalid route admitted', invalid.code)
audio = [a.audio(), b.audio()]
assert min(audio) > 30 and min(MEDIA) > 30, (audio, MEDIA)
assert COUNTS == [1, 1] and not ERRORS, (COUNTS, ERRORS)
for caller in [a, blocked, b, invalid]:
    caller.close()
time.sleep(.3)
retry = Caller(0)
assert retry.code == 200, ('capacity was not released after BYE', retry.code)
retry.close()
print(json.dumps({'tenantGateways': COUNTS, 'callerIdCorrect': not ERRORS, 'mediaEchoPackets': audio, 'carrierMediaPackets': MEDIA, 'capacityDenied': blocked.code, 'invalidGrantDenied': invalid.code, 'capacityReleased': True}))
