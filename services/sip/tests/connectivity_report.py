"""Read-only droplet diagnostics. Never print credentials or raw SIP packets."""
import collections
import re
import subprocess


def run(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        print(f"unavailable: {args[0]} {args[1]}")
        return ''
    if result.returncode:
        print(f"unavailable: {args[0]} {args[1]} (exit {result.returncode})")
    return result.stdout + result.stderr


def main():
    print('WSS proxy directives (secret headers excluded)')
    config = run(['nginx', '-T'])
    for line in config.splitlines():
        if re.match(r'\s*(server_name|listen|location|proxy_pass|proxy_http_version|proxy_read_timeout|proxy_send_timeout|proxy_buffering|worker_connections|worker_processes)\s', line):
            print(line.strip())
        elif re.match(r'\s*proxy_set_header\s+(Upgrade|Connection)\s', line, re.I):
            print(line.strip())
    print('Host firewall')
    print(run(['ufw', 'status', 'verbose']))
    print('TCP listener ports')
    for line in run(['ss', '-ltn']).splitlines():
        if re.search(r':(443|5060|8080)\b', line):
            print(line)
    print('SIP containers')
    print(run(['docker', 'ps', '--format', '{{.Names}} {{.Status}}']))
    print('Kamailio counters, last 2 hours (not unique clients)')
    logs = run(['docker', 'logs', '--since', '2h', '--tail', '30000', 'sip-kamailio-1'])
    counts = collections.Counter()
    by_transport = collections.Counter()
    worker_transport = {}
    for line in logs.splitlines():
        worker = re.search(r'(\d+\(\d+\))', line)
        registration = re.search(r'REGISTER \S+ proto=(\w+)', line)
        if worker and registration:
            worker_transport[worker[1]] = registration[1]
        reason = re.search(r'"reason":"([a-z_]+)"', line)
        if worker and reason:
            by_transport[f"{worker_transport.get(worker[1], 'unknown')}:{reason[1]}"] += 1
        for key in ['REGISTER ok', 'REGISTER auth failed', 'sip-auth unreachable', 'sip-nonce unreachable', 'stale_nonce', 'replayed_digest', 'registration_identity_mismatch', 'tcpconn_do_send', 'Too Many Requests', 'websocket handshake failed']:
            if key in line:
                counts[key] += 1
    print(dict(counts))
    print('Rejections by last REGISTER transport on each worker (best-effort correlation)')
    print(dict(by_transport))
    print('Nginx error categories, last 5000 lines (no client identifiers)')
    errors = run(['tail', '-n', '5000', '/var/log/nginx/error.log'])
    print({key: errors.count(key) for key in ['upstream timed out', 'connect() failed', 'worker_connections are not enough', 'too many open files', 'limiting requests', 'SSL_do_handshake() failed']})
    print('This does not inspect DigitalOcean cloud firewall rules or prove device recovery/audio.')


if __name__ == '__main__':
    main()
