"""Isolated loopback Digest, identity-denial, and RTP test for the relay.

Run in a Python container sharing the FreeSWITCH fixture network namespace.
No packet can reach an external network. Fixtures contain disposable credentials.
"""
import hashlib
import json
import re
import select
import socket
import struct
import threading
import time
import uuid
from pathlib import Path
import temporary_carrier_pbx as control

CFG = json.load(open('/fixtures/settings.json'))
PASSWORD = open('/fixtures/relay-password').read().strip()
DESTINATION = '966135119999'
INVITES = set()
ERRORS = []
MEDIA = 0


def headers(msg):
    return {line.split(':', 1)[0].lower(): line.split(':', 1)[1].strip()
            for line in msg.split('\r\n\r\n')[0].split('\r\n')[1:] if ':' in line}


def sdp(ip, port):
    return f'v=0\r\no=test 1 1 IN IP4 {ip}\r\ns=test\r\nc=IN IP4 {ip}\r\nt=0 0\r\nm=audio {port} RTP/AVP 8\r\na=rtpmap:8 PCMA/8000\r\na=ptime:20\r\na=sendrecv\r\n'


def response(msg, body=''):
    h = headers(msg)
    fields = [f'{name}: {h[name.lower()]}' for name in ['Via', 'From', 'Call-ID', 'CSeq']]
    fields += ['To: ' + h['to'] + (';tag=carrier' if ';tag=' not in h['to'] else '')]
    if body:
        fields += ['Content-Type: application/sdp', f'Contact: <sip:carrier@127.0.0.1:{CFG["carrier_port"]}>']
    return 'SIP/2.0 200 OK\r\n' + '\r\n'.join(fields) + f'\r\nContent-Length: {len(body)}\r\n\r\n' + body


def carrier():
    global MEDIA
    sip = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sip.bind(('127.0.0.1', CFG['carrier_port']))
    rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rtp.bind(('127.0.0.1', 15180))
    while True:
        for ready in select.select([sip, rtp], [], [], 1)[0]:
            raw, addr = ready.recvfrom(65536)
            if ready is rtp:
                MEDIA += 1
                rtp.sendto(raw, addr)
                continue
            msg = raw.decode()
            if msg.startswith('INVITE '):
                h = headers(msg)
                INVITES.add(h['call-id'])
                if not msg.startswith(f'INVITE sip:{DESTINATION}@'):
                    ERRORS.append('Destination normalization failed')
                if not re.search(r'sip:' + CFG['caller_ids'][0] + '@', h['from']):
                    ERRORS.append('Caller identity was not preserved')
                sip.sendto(response(msg, sdp('127.0.0.1', 15180)).encode(), addr)
            elif msg.startswith(('OPTIONS ', 'BYE ', 'CANCEL ')):
                sip.sendto(response(msg).encode(), addr)


class Caller:
    def __init__(self, *, authenticate=True, password=PASSWORD, caller=None, peer='127.0.0.1'):
        self.sip = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sip.bind((peer, 0))
        self.sip.settimeout(8)
        self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.rtp.bind((peer, 0))
        self.peer = peer
        self.port = self.sip.getsockname()[1]
        self.cid = uuid.uuid4().hex
        self.target = f'sip:+{DESTINATION}@{CFG["carrier_ip"]}:{CFG["sip_port"]}'
        caller = caller or '+' + CFG['caller_ids'][0]
        self.from_value = f'<sip:{caller}@{CFG["carrier_ip"]}>;tag={self.cid}'
        self.to_value = f'<{self.target}>'
        self.body = sdp(peer, self.rtp.getsockname()[1])
        self.seq = 1
        self.invite()
        self.final()
        assert self.code in (401, 407), ('Missing initial Digest challenge', self.reply.split('\r\n')[0])
        self.send('ACK', self.seq, branch=self.branch)
        if authenticate:
            challenge = self.h.get('www-authenticate', self.h.get('proxy-authenticate', ''))
            auth = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
            realm, nonce = auth['realm'], auth['nonce']
            assert realm == CFG['carrier_ip']
            md5 = lambda text: hashlib.md5(text.encode()).hexdigest()
            ha1 = md5(f'{CFG["username"]}:{realm}:{password}')
            ha2 = md5(f'INVITE:{self.target}')
            cnonce = uuid.uuid4().hex
            qop = 'auth' if 'auth' in auth.get('qop', '').split(',') else ''
            value = md5(f'{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}' if qop else f'{ha1}:{nonce}:{ha2}')
            digest = f'Digest username="{CFG["username"]}", realm="{realm}", nonce="{nonce}", uri="{self.target}", response="{value}", algorithm=MD5'
            if qop:
                digest += f', qop=auth, nc=00000001, cnonce="{cnonce}"'
            if 'opaque' in auth:
                digest += f', opaque="{auth["opaque"]}"'
            header = 'Proxy-Authorization' if self.code == 407 else 'Authorization'
            self.seq = 2
            self.to_value = f'<{self.target}>'
            self.invite(header + ': ' + digest + '\r\n')
            self.final()
            self.send('ACK', self.seq, branch=self.branch if self.code >= 300 else None)
        if self.code == 200:
            self.media = ('127.0.0.1', int(re.search(r'm=audio (\d+)', self.reply).group(1)))

    def packet(self, method, seq, extra='', body='', branch=None):
        branch = branch or uuid.uuid4().hex
        base = f'Via: SIP/2.0/UDP {self.peer}:{self.port};branch=z9hG4bK{branch}\r\nMax-Forwards: 70\r\nFrom: {self.from_value}\r\nTo: {self.to_value}\r\nCall-ID: {self.cid}\r\nCSeq: {seq} {method}\r\nContact: <sip:caller@{self.peer}:{self.port}>\r\n'
        if body:
            extra += 'Content-Type: application/sdp\r\n'
        return f'{method} {self.target} SIP/2.0\r\n{base}{extra}Content-Length: {len(body)}\r\n\r\n{body}'

    def send(self, method, seq, branch=None):
        self.sip.sendto(self.packet(method, seq, branch=branch).encode(), ('127.0.0.1', CFG['sip_port']))

    def invite(self, extra=''):
        self.branch = uuid.uuid4().hex
        self.sip.sendto(self.packet('INVITE', self.seq, extra, self.body, self.branch).encode(), ('127.0.0.1', CFG['sip_port']))

    def final(self):
        while True:
            self.reply = self.sip.recv(65536).decode()
            self.code = int(self.reply.split()[1])
            if self.code >= 200:
                self.h = headers(self.reply)
                self.to_value = self.h['to']
                if self.code == 200:
                    self.target = re.search(r'<([^>]+)>', self.h['contact']).group(1)
                return

    def audio(self):
        count = 0
        for seq in range(100):
            self.rtp.sendto(struct.pack('!BBHII', 0x80, 8, seq, seq * 160, 12345) + b'\x41' * 160, self.media)
            for ready in select.select([self.rtp], [], [], .02)[0]:
                count += ready.recv(2048)[12:] == b'\x41' * 160
        return count

    def close(self):
        if self.code == 200:
            self.send('BYE', self.seq + 1)
        self.sip.close()
        self.rtp.close()


threading.Thread(target=carrier, daemon=True).start()
control.ROOT = Path('/fixtures')
control.ESL_PORT = CFG['esl_port']
time.sleep(12)
print(control.esl('status'), flush=True)
for kwargs in [dict(authenticate=False), dict(password='0' * 64),
               dict(caller='+966135118888'), dict(peer='127.0.0.2')]:
    print('Testing denial:', ','.join(kwargs), flush=True)
    call = Caller(**kwargs)
    assert call.code >= 400, ('Unauthorized request admitted', kwargs.keys(), call.code)
    call.close()
    time.sleep(.2)
assert not INVITES, 'Unauthorized request reached the carrier'
call = Caller()
assert call.code == 200, ('Authenticated call failed', call.code)
echo = call.audio()
call.close()
assert len(INVITES) == 1 and not ERRORS, (len(INVITES), ERRORS)
assert echo > 30 and MEDIA > 30, ('RTP echo failed', echo, MEDIA)
print(json.dumps(dict(digestRequired=True, invalidPasswordDenied=True, wrongCallerDenied=True,
                     wrongPeerDenied=True, carrierInvites=len(INVITES), callerIdPreserved=True,
                     mediaEchoPackets=echo, carrierMediaPackets=MEDIA)))
