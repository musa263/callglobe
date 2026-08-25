# Vocivo PBX Media Plane

This package moves private extension routing, voicemail, queues, IVR, hold audio, and SIP registration onto a dedicated Vocivo Asterisk service. Vercel remains the control plane. Telnyx remains the PSTN carrier, DID supplier, emergency/STIR-SHAKEN boundary, and fallback media route.

## Infrastructure

- One Linux host with a static public IP and DNS name.
- UDP/TCP 5060, optional TLS 5061, and UDP 10000-20000 open only as required.
- At least 2 vCPU / 4 GB RAM for an initial small organization.
- TLS certificate and SIP firewall/fail2ban before public launch.
- Private monitoring, backups, and an encrypted secret store.

## Start

```bash
cp .env.example .env
docker compose config
docker compose up -d --build
docker compose exec asterisk asterisk -rx "pjsip show registrations"
```

The checked-in extension files contain no credentials. The Vocivo provisioning worker must generate `pjsip_extensions.conf` and `voicemail_users.conf` from tenant records, atomically replace them, validate with `asterisk -rx "dialplan reload"`, and roll back on failure.

Do not switch `platform.mediaPlane` to `vocivo` until registration, NAT traversal, TLS/SRTP, inbound DID routing, emergency calling, failover, and load tests pass on the dedicated host.
