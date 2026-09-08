#!/usr/bin/env python3
"""Exercise generated gateway includes with production FreeSWITCH startup, offline."""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

from relay_operations import gateway_xml
from temporary_carrier_pbx import IMAGE


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=60)


def main():
    name = 'vocivo-gateway-load-' + uuid.uuid4().hex[:10]
    source = Path(__file__).resolve().parents[1] / 'freeswitch'
    cfg = {'gateway': 'byoc_load_probe', 'carrier_ip': '127.0.0.3', 'carrier_port': 5060,
           'public_ip': '127.0.0.4', 'sip_port': 5062, 'username': 'relay_probe', 'password': 'a' * 64}
    started = False
    try:
        run('docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '768m',
            '--pids-limit', '256', '-v', str(source) + ':/opt/vocivo-fs:ro',
            '-e', 'PUBLIC_IP=127.0.0.2', '-e', 'TELNYX_SIP_HOST=127.0.0.3',
            '-e', 'TELNYX_SIP_REALM=127.0.0.3', '--entrypoint', '/bin/sh', IMAGE,
            '/opt/vocivo-fs/docker-entrypoint.sh')
        started = True

        def fs(command):
            return run('docker', 'exec', name, 'fs_cli', '-x', command).stdout

        time.sleep(12)
        if 'is ready' not in fs('status') or 'trunk' not in fs('sofia status'):
            raise RuntimeError('Production fixture did not start')
        with tempfile.TemporaryDirectory(prefix='vocivo-gateway-include-') as directory:
            path = Path(directory) / 'gateway.xml'

            def load(payload):
                path.write_text(payload)
                path.chmod(0o600)
                run('docker', 'cp', str(path), name + ':/etc/freeswitch/sip_profiles/carriers/byoc_probe.xml')
                fs('sofia profile trunk rescan reloadxml')
                return fs('sofia status gateway ' + cfg['gateway'])

            # Establish the reported failure: syntactically valid compact XML
            # silently disappears in FreeSWITCH's line-oriented include pass.
            compact_root = ET.fromstring(gateway_xml(cfg))
            for node in compact_root.iter():
                node.text = node.tail = None
            compact = ET.tostring(compact_root, encoding='unicode')
            if 'Invalid Gateway' not in load(compact):
                raise AssertionError('Compact include no longer reproduces the production failure')
            status = load(gateway_xml(cfg))
            fields = dict(line.split(None, 1) for line in status.splitlines() if len(line.split(None, 1)) == 2)
            if fields.get('Name') != cfg['gateway'] or fields.get('Profile') != 'trunk':
                raise AssertionError('Generated gateway was not loaded into the production trunk profile')
        print(json.dumps({'compactIncludeFailureReproduced': True, 'generatedGatewayLoaded': True,
                          'productionStartupUsed': True, 'externalNetwork': False}))
    finally:
        if started:
            run('docker', 'rm', '-f', name, check=False)


if __name__ == '__main__':
    main()
