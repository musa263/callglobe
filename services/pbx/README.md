# Vocivo FreeSWITCH Media Plane

This package is the dedicated Vocivo PBX foundation for DigitalOcean. FreeSWITCH owns SIP registration, internal extensions, RTP, voicemail, conferences and carrier bridging. Vercel remains the SaaS control plane. Telnyx or GO Telecom remains the regulated PSTN/DID/SMS carrier until those services are replaced by another licensed carrier.

## Components

- FreeSWITCH 1.11.1, built from the official SignalWire source tag.
- `mod_sofia` for carrier SIP, extension registration and SIP over WebSocket.
- `mod_verto` for optional browser WebRTC signaling.
- `mod_event_socket` on loopback only.
- Node.js ESL listener for authoritative call events and mobile push fan-out.
- Caddy for public WSS endpoints and automatic TLS.
- Coturn with expiring HMAC credentials for WebRTC media on restrictive mobile NAT.
- Asterisk is retained only under the `legacy-asterisk` Compose profile.

## Public Network Surface

| Purpose | Public endpoint |
| --- | --- |
| Carrier SIP | `sip:PBX_PUBLIC_IP:5060` over UDP/TCP |
| SIP over WSS | `wss://PBX_WSS_DOMAIN` |
| Verto | `wss://PBX_VERTO_DOMAIN` |
| RTP/SRTP | UDP `20000-29999` |
| TURN | UDP/TCP `3478`, TLS-over-TCP `443`, relay UDP `30000-39999` |

ESL `8021`, health `8088`, Sofia WS `5066` and Verto WS `8081` bind to loopback. Never open them in the DigitalOcean firewall.

## DigitalOcean Deployment

1. For a private pilot, create an Ubuntu 24.04 Basic Droplet with 1 vCPU and 1 GB RAM plus swap; keep `PBX_MAX_SESSIONS=50` and `PBX_SESSIONS_PER_SECOND=10`. Commercial production requires dedicated CPU nodes sized from measured concurrent-call and transcoding load. Attach a Reserved IP.
2. Add DNS A records for `PBX_SIP_DOMAIN`, `PBX_WSS_DOMAIN` and `PBX_VERTO_DOMAIN` to the Reserved IP.
3. Set `CARRIER_CIDRS` to the carrier's published signaling networks, then copy and run `digitalocean/bootstrap-host.sh` as root. Without this value, SIP port `5060` stays blocked.
4. Copy `.env.example` to `.env`, replace every placeholder, and create `secrets/turn-auth-secret` with at least 32 random characters. Set the same value only in Vercel's encrypted `VOCIVO_TURN_SECRET` variable.
5. Put the APNs `.p8` key and Firebase service-account JSON in the ignored `services/pbx/secrets` directory. Set `PBX_HOST` locally and run `digitalocean/deploy.sh`.
6. Point the carrier trunk to the Reserved IP on port `5060` only after inbound and outbound tests pass.

The source build is intentionally pinned. Build the image in CI and store it in a private registry before adding a second node; do not compile independently on every production restart.

## Verification

```bash
docker compose ps
docker compose exec freeswitch /usr/local/freeswitch/bin/fs_cli -x status
docker compose exec freeswitch /usr/local/freeswitch/bin/fs_cli -x "sofia status"
docker compose exec freeswitch /usr/local/freeswitch/bin/fs_cli -x "sofia status gateway telnyx"
curl --fail http://127.0.0.1:8088/healthz
docker compose logs --since=10m freeswitch esl-listener
docker compose exec coturn turnutils_stunclient -p 3478 127.0.0.1
```

Register two clients as the bootstrap extension to confirm parallel forking. Then test internal audio in both directions, DTMF, hold/resume, answer/hangup synchronization, voicemail, conference media, NAT traversal and calls through each configured carrier.

## Current Pilot Status

The Vercel production control plane now returns `provider = "freeswitch"`, and both web and mobile clients use SIP over WSS. Dynamic tenant users are served through signed XML Curl snapshots. The current public endpoints are:

- Reserved SIP IP: `68.183.244.215`
- SIP domain: `sip.68.183.244.215.nip.io`
- SIP over WSS: `wss://sip-wss.68.183.244.215.nip.io`
- Verto over WSS: `wss://verto.68.183.244.215.nip.io`
- TURN: `turn:68.183.244.215:3478?transport=udp` with `turns://` TLS fallback on `443`

The pilot Telnyx IP-authenticated trunk is attached to the reserved SIP IP. On DigitalOcean, `PBX_CARRIER_BIND_IP` must be the Droplet anchor IPv4 and the default route must use the anchor gateway; otherwise outbound SIP originates from the Droplet IP and carrier authentication fails. APNs and FCM remain disabled until their production credentials are mounted. Before commercial launch, add a second node, backups, observability, carrier failover, and measured load tests.

The checked-in bootstrap extension is for a private smoke test. Its password must never be reused in production.
