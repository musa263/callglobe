#!/usr/bin/env python3
"""Operator-run, isolated IP-auth carrier audio test. Never activates a tenant.

No existing PBX service or firewall is changed by this tool. Stop/start any
conflicting PBX only under a separately verified, timed restoration procedure.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET

IMAGE = 'safarov/freeswitch@sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6'
DOCKER_URL = 'https://download.docker.com/linux/static/stable/x86_64/docker-29.7.2.tgz'
DOCKER_SHA = '803d433f226db4776e1768fd319fc6c6e4935a456acf84fcc0080818b854bc8f'
ROOT = Path('/opt/vocivo-carrier-test')
CONTAINER = 'vocivo-carrier-test'
DAEMON = 'vocivo-carrier-test-docker'
ESL_PORT = 18021


def run(*args, timeout=60, check=True):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=check)


def number(value):
    if not re.fullmatch(r'[1-9][0-9]{7,14}', value):
        raise ValueError('Use country-code digits, without + or punctuation')
    return value


def validate(cfg):
    for name in ('public_ip', 'carrier_ip'):
        ipaddress.IPv4Address(cfg[name])
    number(cfg['did'])
    number(cfg['caller_id'])
    if not re.fullmatch(r'0[0-9]{7,14}', cfg['national_did']):
        raise ValueError('National DID must contain digits beginning with 0')
    if cfg['sip_port'] not in (5060, 5062, 15060):
        raise ValueError('Unsupported temporary SIP port')


def config_xml(cfg, password):
    validate(cfg)
    root = ET.Element('document', type='freeswitch/xml')
    section = ET.SubElement(root, 'section', name='configuration')

    def configuration(name):
        return ET.SubElement(section, 'configuration', name=name)

    def params(parent, values):
        for name, value in values.items():
            ET.SubElement(parent, 'param', name=name, value=str(value))

    modules = ET.SubElement(configuration('modules.conf'), 'modules')
    for module in ('console', 'logfile', 'commands', 'dptools', 'dialplan_xml',
                   'sofia', 'event_socket', 'tone_stream', 'json_cdr'):
        ET.SubElement(modules, 'load', module='mod_' + module)
    params(ET.SubElement(configuration('switch.conf'), 'settings'), {
        'loglevel': 'warning', 'max-sessions': 2, 'sessions-per-second': 5,
        'rtp-start-port': 9900, 'rtp-end-port': 9919})
    params(ET.SubElement(configuration('console.conf'), 'settings'), {'loglevel': 'warning'})
    params(ET.SubElement(configuration('event_socket.conf'), 'settings'), {
        'nat-map': 'false', 'listen-ip': '127.0.0.1', 'listen-port': ESL_PORT,
        'password': password, 'apply-inbound-acl': 'loopback.auto'})
    params(ET.SubElement(configuration('json_cdr.conf'), 'settings'), {
        'log-dir': '/state/cdr', 'log-b-leg': 'false', 'encode-values': 'false'})
    lists = ET.SubElement(configuration('acl.conf'), 'network-lists')
    acl = ET.SubElement(lists, 'list', name='test-carrier', default='deny')
    ET.SubElement(acl, 'node', type='allow', cidr=cfg['carrier_ip'] + '/32')
    profile = ET.SubElement(ET.SubElement(configuration('sofia.conf'), 'profiles'),
                            'profile', name='carrier-test')
    params(ET.SubElement(profile, 'settings'), {
        'sip-ip': cfg['public_ip'], 'rtp-ip': cfg['public_ip'],
        'sip-port': cfg['sip_port'], 'dialplan': 'XML', 'context': 'carrier-in',
        'auth-calls': 'false', 'apply-inbound-acl': 'test-carrier',
        'disable-register': 'true', 'manage-presence': 'false',
        'inbound-codec-prefs': 'PCMA,PCMU', 'outbound-codec-prefs': 'PCMA,PCMU',
        'sip-trace': 'no', 'user-agent-string': 'Vocivo-Carrier-Verification'})
    dialplan = ET.SubElement(root, 'section', name='dialplan')
    inbound = ET.SubElement(dialplan, 'context', name='carrier-in')
    route = ET.SubElement(ET.SubElement(inbound, 'extension', name='explicit-test-did'),
                          'condition', field='destination_number',
                          expression=r'^(?:\+?' + cfg['did'] + '|' + cfg['national_did'] + ')$')
    ET.SubElement(route, 'action', application='transfer', data='test XML audio-test')
    audio = ET.SubElement(dialplan, 'context', name='audio-test')
    route = ET.SubElement(ET.SubElement(audio, 'extension', name='bounded-audio-test'),
                          'condition', field='destination_number', expression='^test$')
    for app, data in [('answer', ''), ('sched_hangup', '+35 NORMAL_CLEARING'),
                      ('playback', 'tone_stream://%(1000,500,440)'), ('echo', '')]:
        ET.SubElement(route, 'action', application=app, data=data)
    return ET.tostring(root, encoding='unicode')


def docker(*args, **kwargs):
    return run(str(ROOT / 'docker/docker'), '--host', 'unix://' + str(ROOT / 'docker.sock'),
               *args, **kwargs)


def esl(command, background=False):
    password = (ROOT / 'esl-password').read_text().strip()
    with socket.create_connection(('127.0.0.1', ESL_PORT), timeout=5) as sock:
        reader = sock.makefile('rb')

        def frame():
            headers = {}
            while True:
                line = reader.readline()
                if not line:
                    raise RuntimeError('Event socket closed')
                if not line.strip():
                    break
                key, value = line.decode().strip().split(':', 1)
                headers[key.lower()] = value.strip()
            size = int(headers.get('content-length', '0'))
            body = reader.read(size).decode() if size else headers.get('reply-text', '')
            return headers, body

        if frame()[0].get('content-type') != 'auth/request':
            raise RuntimeError('Expected ESL authentication challenge')
        sock.sendall(('auth ' + password + '\n\n').encode())
        if not frame()[1].startswith('+OK'):
            raise RuntimeError('ESL authentication failed')
        sock.sendall((('bgapi ' if background else 'api ') + command + '\n\n').encode())
        return frame()[1]


def ports_free(public_ip, sip_port):
    # Hold every test port until all binds succeed, then release before launch.
    sockets = []
    try:
        for ip, port, kind in [(public_ip, sip_port, socket.SOCK_DGRAM),
                               (public_ip, sip_port, socket.SOCK_STREAM),
                               ('127.0.0.1', ESL_PORT, socket.SOCK_STREAM)] + [
                                   (public_ip, port, socket.SOCK_DGRAM) for port in range(9900, 9920)]:
            probe = socket.socket(socket.AF_INET, kind)
            sockets.append(probe)
            probe.bind((ip, port))
    finally:
        for probe in sockets:
            probe.close()


def prepare(cfg):
    validate(cfg)
    if ROOT.exists():
        raise RuntimeError('Test directory already exists; inspect it before reusing')
    if shutil.disk_usage('/opt').free < 12 * 1024**3:
        raise RuntimeError('Need 12 GiB free for the isolated Docker VFS image store')
    ports_free(cfg['public_ip'], cfg['sip_port'])
    ROOT.mkdir(mode=0o700)
    for folder in ('conf', 'state', 'state/cdr', 'state/log', 'state/db', 'state/run'):
        (ROOT / folder).mkdir(mode=0o700)
    (ROOT / 'settings.json').write_text(json.dumps(cfg))
    password = secrets.token_hex(24)
    (ROOT / 'esl-password').write_text(password)
    (ROOT / 'conf/freeswitch.xml').write_text(config_xml(cfg, password))
    archive = ROOT / 'docker.tgz'
    print('Fetching pinned official temporary Docker runtime...', flush=True)
    with urllib.request.urlopen(DOCKER_URL, timeout=120) as response, archive.open('wb') as output:
        shutil.copyfileobj(response, output)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != DOCKER_SHA:
        raise RuntimeError('Docker archive checksum mismatch')
    with tarfile.open(archive) as package:
        for entry in package.getmembers():
            if not re.fullmatch(r'docker/?|docker/[a-z0-9-]+', entry.name) or not (entry.isfile() or entry.isdir()):
                raise RuntimeError('Unexpected archive entry')
        package.extractall(ROOT)
    archive.unlink()
    (ROOT / 'daemon.json').write_text(json.dumps({
        'data-root': str(ROOT / 'data'), 'exec-root': str(ROOT / 'exec'),
        'pidfile': str(ROOT / 'docker.pid'), 'hosts': ['unix://' + str(ROOT / 'docker.sock')],
        'bridge': 'none', 'iptables': False, 'ip6tables': False, 'ip-forward': False,
        'ip-masq': False, 'userland-proxy': False, 'storage-driver': 'vfs',
        'features': {'containerd-snapshotter': False}}))
    run('systemd-run', '--unit=' + DAEMON, '--property=RuntimeMaxSec=7200',
        '--setenv=PATH=' + str(ROOT / 'docker') + ':/usr/sbin:/usr/bin:/sbin:/bin',
        str(ROOT / 'docker/dockerd'), '--config-file', str(ROOT / 'daemon.json'))
    for attempt in range(30):
        if (ROOT / 'docker.sock').exists() and docker('info', check=False).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Temporary Docker daemon did not become ready')
    print('Pulling pinned FreeSWITCH image; existing PBX remains untouched...', flush=True)
    docker('pull', '--platform', 'linux/amd64', IMAGE, timeout=600)
    print('Prepared. No PBX listener has been started.')


def start():
    cfg = json.loads((ROOT / 'settings.json').read_text())
    validate(cfg)
    ports_free(cfg['public_ip'], cfg['sip_port'])
    result = docker('run', '-d', '--name', CONTAINER, '--network', 'host',
                    '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
                    '--log-driver', 'local', '--log-opt', 'max-size=5m',
                    '--mount', f'type=bind,src={ROOT / "conf"},dst=/conf,readonly',
                    '--mount', f'type=bind,src={ROOT / "state"},dst=/state',
                    '--entrypoint', '/usr/bin/freeswitch', IMAGE,
                    '-nf', '-nonat', '-np', '-conf', '/conf', '-log', '/state/log',
                    '-db', '/state/db', '-run', '/state/run', '-mod', '/usr/lib/freeswitch/mod')
    for attempt in range(30):
        try:
            if 'RUNNING' in esl('sofia status'):
                print('Temporary carrier profile ready on UDP/TCP ' + str(cfg['sip_port']))
                return
        except (OSError, RuntimeError):
            pass
        time.sleep(1)
    docker('stop', '--time', '5', CONTAINER, check=False)
    raise RuntimeError('Temporary carrier profile failed readiness; container stopped')


def call(destination):
    number(destination)
    cfg = json.loads((ROOT / 'settings.json').read_text())
    call_id = str(uuid.uuid4())
    variables = (f'origination_uuid={call_id},origination_caller_id_number={cfg["caller_id"]},'
                 f'sip_from_user={cfg["caller_id"]},sip_cid_type=pid,'
                 'originate_timeout=20,ignore_early_media=true')
    # A detached originate returns immediately. Never automatically retry a call.
    response = esl('originate {' + variables + '}sofia/carrier-test/' + destination +
                   '@' + cfg['carrier_ip'] + ':5060 test XML audio-test', background=True)
    if '-ERR' in response:
        raise RuntimeError('Originate rejected: ' + response.strip())
    print(json.dumps({'call_uuid': call_id, 'destination_suffix': destination[-4:],
                      'status': response.strip()}))


def reports():
    for path in sorted((ROOT / 'state/cdr').glob('*.json'))[-10:]:
        data = json.loads(path.read_text())
        values = data.get('variables', {})
        print(json.dumps({key: values.get(key) for key in (
            'uuid', 'direction', 'start_stamp', 'answer_stamp', 'end_stamp', 'billsec',
            'hangup_cause', 'sip_term_status', 'read_codec', 'write_codec',
            'rtp_audio_in_packet_count', 'rtp_audio_out_packet_count',
            'rtp_audio_in_media_packet_count', 'rtp_audio_out_media_packet_count')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('prepare', 'render'):
        command = sub.add_parser(action)
        for name in ('public-ip', 'carrier-ip', 'did', 'national-did', 'caller-id'):
            command.add_argument('--' + name, required=True)
        command.add_argument('--sip-port', type=int, default=5062)
    for action in ('start', 'status', 'reports', 'stop'):
        sub.add_parser(action)
    sub.add_parser('call').add_argument('destination')
    args = parser.parse_args()
    if args.action == 'render':
        print(config_xml(vars(args), 'local-test-password'))
        return
    if os.geteuid() != 0:
        raise RuntimeError('Run on the authorized Linux host as root')
    os.umask(0o077)
    if args.action == 'prepare':
        prepare(vars(args))
    elif args.action == 'start':
        start()
    elif args.action == 'call':
        call(args.destination)
    elif args.action == 'status':
        print(esl('status'))
        print(esl('sofia status profile carrier-test'))
    elif args.action == 'reports':
        reports()
    elif args.action == 'stop':
        docker('stop', '--time', '5', CONTAINER, check=False)
        run('systemctl', 'stop', DAEMON + '.service')
        print('Temporary test runtime stopped. Existing PBX units were not changed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        # Command output can contain credentials/phone numbers. Keep it on host.
        print(type(error).__name__ + ': ' + ('Operation failed; inspect private host logs.'
              if isinstance(error, subprocess.SubprocessError) else str(error)), file=sys.stderr)
        sys.exit(1)
