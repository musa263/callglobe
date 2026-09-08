#!/usr/bin/env python3
"""Render a private, authenticated outbound-only carrier relay test.

Does not start services, change a firewall, activate a tenant, or place a call.
The operator supplies the published tenant's caller IDs and actual host address.
"""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import secrets
import xml.etree.ElementTree as ET


def relay_xml(cfg, password, esl_password):
    for name in ('public_ip', 'carrier_ip', 'peer_ip'):
        ipaddress.IPv4Address(cfg[name])
    for name in ('sip_port', 'carrier_port', 'esl_port', 'rtp_start', 'rtp_end'):
        if not isinstance(cfg[name], int) or not 1024 <= cfg[name] <= 65535:
            raise ValueError('Invalid port')
    if cfg['rtp_end'] - cfg['rtp_start'] < 19 or cfg['rtp_end'] - cfg['rtp_start'] > 99:
        raise ValueError('Use a small dedicated RTP range')
    if type(cfg['channel_limit']) is not int or not 1 <= cfg['channel_limit'] <= 5:
        raise ValueError('Temporary test supports at most five calls')
    if not re.fullmatch(r'[a-z0-9_-]{8,64}', cfg['username']):
        raise ValueError('Invalid relay identity')
    if not re.fullmatch(r'[a-f0-9]{48,128}', password) or not re.fullmatch(r'[a-f0-9]{48,128}', esl_password):
        raise ValueError('Use generated private relay credentials')
    callers = cfg['caller_ids']
    if not isinstance(callers, list) or not 1 <= len(callers) <= 5 or len(set(callers)) != len(callers):
        raise ValueError('Supply only the published tenant caller IDs')
    if any(not re.fullmatch(r'[1-9][0-9]{7,14}', number) for number in callers):
        raise ValueError('Caller IDs must be country-code digits')

    root = ET.Element('document', type='freeswitch/xml')
    section = ET.SubElement(root, 'section', name='configuration')

    def configuration(name):
        return ET.SubElement(section, 'configuration', name=name)

    def params(parent, values):
        for name, value in values.items():
            ET.SubElement(parent, 'param', name=name, value=str(value))

    modules = ET.SubElement(configuration('modules.conf'), 'modules')
    for module in ('console', 'logfile', 'commands', 'dptools', 'dialplan_xml', 'sofia', 'event_socket', 'json_cdr'):
        ET.SubElement(modules, 'load', module='mod_' + module)
    params(ET.SubElement(configuration('switch.conf'), 'settings'), {
        'loglevel': 'warning', 'max-sessions': cfg['channel_limit'] * 2,
        'sessions-per-second': 10, 'rtp-start-port': cfg['rtp_start'], 'rtp-end-port': cfg['rtp_end']})
    params(ET.SubElement(configuration('console.conf'), 'settings'), {'loglevel': 'warning'})
    log_profile = ET.SubElement(ET.SubElement(configuration('logfile.conf'), 'profiles'), 'profile', name='default')
    params(ET.SubElement(log_profile, 'settings'), {'logfile': '/state/log/freeswitch.log', 'rollover': 1048576})
    ET.SubElement(ET.SubElement(log_profile, 'mappings'), 'map', name='all', value='warning,err,crit,alert')
    params(ET.SubElement(configuration('event_socket.conf'), 'settings'), {
        'nat-map': 'false', 'listen-ip': '127.0.0.1', 'listen-port': cfg['esl_port'],
        'password': esl_password, 'apply-inbound-acl': 'loopback.auto'})
    params(ET.SubElement(configuration('json_cdr.conf'), 'settings'), {
        'log-dir': '/state/cdr', 'log-b-leg': 'true', 'encode-values': 'false'})
    profile = ET.SubElement(ET.SubElement(configuration('sofia.conf'), 'profiles'), 'profile', name='carrier-relay')
    params(ET.SubElement(profile, 'settings'), {
        'sip-ip': cfg['public_ip'], 'rtp-ip': cfg['public_ip'], 'sip-port': cfg['sip_port'],
        'dialplan': 'XML', 'context': 'carrier-relay', 'auth-calls': 'true',
        # Do not add an inbound ACL here: a passing Sofia ACL can bypass Digest.
        # The authenticated dialplan separately checks the exact peer address.
        'challenge-realm': cfg['carrier_ip'], 'disable-register': 'true',
        'manage-presence': 'false', 'inbound-codec-prefs': 'PCMA,PCMU',
        'outbound-codec-prefs': 'PCMA,PCMU', 'sip-trace': 'no',
        'user-agent-string': 'Vocivo-Temporary-Carrier-Relay'})
    directory = ET.SubElement(root, 'section', name='directory')
    domain = ET.SubElement(directory, 'domain', name=cfg['carrier_ip'])
    user = ET.SubElement(ET.SubElement(domain, 'users'), 'user', id=cfg['username'])
    params(ET.SubElement(user, 'params'), {'password': password})
    variables = ET.SubElement(user, 'variables')
    ET.SubElement(variables, 'variable', name='user_context', value='carrier-relay')

    context = ET.SubElement(ET.SubElement(root, 'section', name='dialplan'), 'context', name='carrier-relay')
    route = ET.SubElement(context, 'extension', name='authenticated-tenant-outbound')
    ET.SubElement(route, 'condition', field='network_addr', expression='^' + re.escape(cfg['peer_ip']) + '$')
    ET.SubElement(route, 'condition', field='${sip_auth_username}', expression='^' + cfg['username'] + '$')
    identity = ET.SubElement(route, 'condition', field='caller_id_number', expression=r'^\+?(' + '|'.join(callers) + ')$')
    ET.SubElement(identity, 'action', application='set', data='effective_caller_id_number=$1')
    ET.SubElement(identity, 'action', application='set', data='sip_cid_type=pid')
    destination = ET.SubElement(route, 'condition', field='destination_number', expression=r'^\+?([1-9][0-9]{7,14})$')
    ET.SubElement(destination, 'action', application='set', data='hangup_after_bridge=true')
    ET.SubElement(destination, 'action', application='set', data='call_timeout=30')
    ET.SubElement(destination, 'action', application='sched_hangup', data='+180 NORMAL_CLEARING')
    ET.SubElement(destination, 'action', application='bridge', data=f'sofia/carrier-relay/$1@{cfg["carrier_ip"]}:{cfg["carrier_port"]}')
    fallback = ET.SubElement(ET.SubElement(context, 'extension', name='deny-all-other-calls'), 'condition')
    ET.SubElement(fallback, 'action', application='hangup', data='CALL_REJECTED')
    return ET.tostring(root, encoding='unicode')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('public-ip', 'carrier-ip', 'peer-ip', 'username'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--caller-ids', required=True, help='Published tenant caller IDs, comma-separated country-code digits')
    for key, default in [('sip-port', 5062), ('carrier-port', 5060), ('esl-port', 18022),
                         ('rtp-start', 11000), ('rtp-end', 11019), ('channel-limit', 5)]:
        parser.add_argument('--' + key, type=int, default=default)
    parser.add_argument('--output-dir', required=True)
    args = vars(parser.parse_args())
    output = Path(args.pop('output_dir'))
    args['caller_ids'] = args['caller_ids'].split(',')
    password, esl_password = secrets.token_hex(32), secrets.token_hex(32)
    xml = relay_xml(args, password, esl_password)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name, data in [('freeswitch.xml', xml), ('relay-password', password),
                       ('esl-password', esl_password), ('settings.json', json.dumps(args))]:
        path = output / name
        with path.open('x') as handle:
            path.chmod(0o600)
            handle.write(data)
    print('Private relay configuration prepared. No listener, activation or call started.')


if __name__ == '__main__':
    main()
