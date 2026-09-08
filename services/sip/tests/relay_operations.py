#!/usr/bin/env python3
"""Fixed operator actions for an expiring outbound-only relay; never stops 3CX."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from temporary_carrier_pbx import IMAGE
from temporary_carrier_relay import relay_xml

ROOT = Path('/opt/vocivo-temporary-relay')
RUNTIME = Path('/opt/vocivo-carrier-test')
OPS = Path('/opt/vocivo-carrier-relay-ops')
CONTAINER = 'vocivo-carrier-relay-test'
DAEMON = 'vocivo-carrier-relay-docker'


def run(*args, check=True, timeout=45, **kw):
    return subprocess.run(args, check=check, timeout=timeout, text=True, capture_output=True, **kw)


def config(data):
    if not isinstance(data['organizationId'], str) or not data['organizationId'] or not isinstance(data['trunkId'], str):
        raise ValueError('Explicit tenant and trunk identities are required')
    if type(data['revision']) is not int or data['revision'] < 1:
        raise ValueError('Invalid connection revision')
    expected = 'byoc_' + hashlib.sha256(json.dumps([data['organizationId'], data['trunkId'], data['revision']], separators=(',', ':')).encode()).hexdigest()[:32]
    if data['gateway'] != expected or not re.fullmatch(r'byoc_[0-9a-f]{32}', expected):
        raise ValueError('Gateway binding mismatch')
    relay_xml(data, data['password'], 'a' * 64)
    return data


def remaining(cfg):
    deadline = dt.datetime.fromisoformat(cfg['expiresAt'].replace('Z', '+00:00'))
    seconds = int((deadline - dt.datetime.now(dt.timezone.utc)).total_seconds())
    if not 60 <= seconds <= 1500:
        raise ValueError('Temporary deadline must be between one and 25 minutes away')
    return seconds


def docker(*args, **kw):
    return run(str(RUNTIME / 'docker/docker'), '--host', 'unix://' + str(RUNTIME / 'docker.sock'), *args, **kw)


def fs(*args, check=True):
    return run('docker', 'compose', 'exec', '-T', 'freeswitch', *args,
               cwd='/opt/vocivo/sip', check=check)


def save(cfg):
    ROOT.mkdir(mode=0o700, exist_ok=False)
    (ROOT / 'settings.json').write_text(json.dumps(cfg))


def arm(role, seconds):
    # The timer is armed before creating a listener or installing a gateway.
    run('systemd-run', '--unit=vocivo-temporary-' + role + '-expiry', '--on-active=' + str(seconds),
        '--timer-property=AccuracySec=1s', sys.executable, str(OPS / 'relay_operations.py'), 'remove-' + role)


def install_relay(cfg):
    seconds = remaining(cfg)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind((cfg['public_ip'], cfg['sip_port']))
    probes = []
    try:
        for port in range(cfg['rtp_start'], cfg['rtp_end'] + 1):
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probes.append(probe)
            probe.bind((cfg['public_ip'], port))
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probes.append(probe)
        probe.bind(('127.0.0.1', cfg['esl_port']))
    finally:
        for probe in probes:
            probe.close()
    if not (RUNTIME / 'daemon.json').is_file() or docker('info', check=False).returncode == 0:
        raise RuntimeError('Expected the prepared, stopped isolated Docker runtime')
    save(cfg)
    arm('relay', seconds + 30)
    esl_password = secrets.token_hex(32)
    (ROOT / 'esl-password').write_text(esl_password)
    (ROOT / 'freeswitch.xml').write_text(relay_xml(cfg, cfg['password'], esl_password))
    for folder in ('state/log', 'state/db', 'state/run', 'state/cdr'):
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
    run('systemd-run', '--unit=' + DAEMON, '--property=RuntimeMaxSec=' + str(seconds + 60),
        '--setenv=PATH=' + str(RUNTIME / 'docker') + ':/usr/sbin:/usr/bin:/sbin:/bin',
        str(RUNTIME / 'docker/dockerd'), '--config-file', str(RUNTIME / 'daemon.json'))
    for _ in range(30):
        if docker('info', check=False).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Isolated daemon failed to start')
    docker('run', '-d', '--name', CONTAINER, '--network', 'host', '--memory', '512m', '--cpus', '1',
           '--pids-limit', '128', '--log-driver', 'local', '--log-opt', 'max-size=5m',
           '-v', str(ROOT) + ':/conf:ro', '-v', str(ROOT / 'state') + ':/state',
           '--entrypoint', '/usr/bin/freeswitch', IMAGE, '-nf', '-nonat', '-np',
           '-conf', '/conf', '-log', '/state/log', '-db', '/state/db', '-run', '/state/run', '-mod', '/usr/lib/freeswitch/mod')
    import temporary_carrier_pbx as control
    control.ROOT, control.ESL_PORT = ROOT, cfg['esl_port']
    time.sleep(12)
    if 'is ready' not in control.esl('status'):
        raise RuntimeError('Relay core is not ready')
    print('Authenticated outbound relay ready; timed stop armed. 3CX was not changed.')


def install_gateway(cfg):
    seconds = remaining(cfg)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect((cfg['public_ip'], cfg['sip_port']))
        if probe.getsockname()[0] != cfg['peer_ip']:
            raise RuntimeError('SIP host source does not match the permitted relay peer')
    current = fs('cat', '/etc/freeswitch/sip_profiles/trunk.xml').stdout
    if 'carriers/*.xml' not in current:
        raise RuntimeError('Synchronize the matching BYOC SIP configuration first')
    target = Path('/opt/vocivo/carriers') / (cfg['gateway'] + '.xml')
    if target.exists():
        raise RuntimeError('Refusing to replace an existing gateway')
    save(cfg)
    arm('gateway', seconds)
    root = ET.Element('include')
    gateway = ET.SubElement(root, 'gateway', name=cfg['gateway'])
    params = {'proxy': f'{cfg["carrier_ip"]}:{cfg["carrier_port"]}', 'realm': cfg['carrier_ip'],
              'outbound-proxy': f'{cfg["public_ip"]}:{cfg["sip_port"]}',
              'username': cfg['username'], 'password': cfg['password'], 'register': 'false',
              'register-transport': 'udp', 'caller-id-in-from': 'true', 'from-domain': cfg['carrier_ip'],
              'extension-in-contact': 'true', 'ping': '30'}
    for name, value in params.items():
        ET.SubElement(gateway, 'param', name=name, value=value)
    target.parent.mkdir(mode=0o700, exist_ok=True)
    target.write_text(ET.tostring(root, encoding='unicode'))
    container = run('docker', 'compose', 'ps', '-q', 'freeswitch', cwd='/opt/vocivo/sip').stdout.strip()
    if not re.fullmatch(r'[a-f0-9]{12,64}', container):
        raise RuntimeError('FreeSWITCH container unavailable')
    run('docker', 'cp', str(target), container + ':/etc/freeswitch/sip_profiles/carriers/' + target.name)
    result = fs('fs_cli', '-x', 'sofia profile trunk rescan reloadxml').stdout
    if '-ERR' in result:
        raise RuntimeError('Gateway rescan failed')
    print('Temporary gateway installed; timed removal armed. No other gateway was replaced.')


def remove(role):
    if not (ROOT / 'settings.json').exists():
        return
    cfg = config(json.loads((ROOT / 'settings.json').read_text()))
    if role == 'relay':
        docker('stop', '--time', '5', CONTAINER, check=False)
        docker('rm', CONTAINER, check=False)
        run('systemctl', 'stop', DAEMON + '.service', check=False)
    else:
        filename = cfg['gateway'] + '.xml'
        fs('rm', '-f', '/etc/freeswitch/sip_profiles/carriers/' + filename, check=False)
        (Path('/opt/vocivo/carriers') / filename).unlink(missing_ok=True)
        fs('fs_cli', '-x', 'sofia profile trunk killgw ' + cfg['gateway'], check=False)
    (ROOT / 'removed').write_text(dt.datetime.now(dt.timezone.utc).isoformat())
    print('Temporary ' + role + ' stopped/removed. Existing PBX services were not stopped.')


def install(role, cfg):
    owned = not ROOT.exists()
    try:
        (install_relay if role == 'relay' else install_gateway)(cfg)
    except Exception:
        if owned and ROOT.exists():
            remove(role)
        raise


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Root is required on the authorized host')
    os.umask(0o077)
    action = sys.argv[1]
    try:
        if action in ('remove-relay', 'remove-gateway'):
            remove(action.split('-', 1)[1])
        elif action in ('install-relay', 'install-gateway'):
            cfg = config(json.load(sys.stdin))
            install(action.split('-', 1)[1], cfg)
        else:
            raise ValueError('Unsupported operation')
    except Exception as error:
        # Keep command output, password material and complete numbers private.
        print('Temporary relay operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
