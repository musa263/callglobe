# Vocivo SIP edge

Kamailio (registrar, WSS, fork), RTPEngine (media), and FreeSWITCH (Telnyx PSTN gateway). Telnyx is only an Elastic SIP trunk. Internal calls stay on this host and are not billed as Telnyx Call Control.

Production web and iOS stay on the Telnyx SDK until `VOCIVO_VOICE_EDGE=sip` is set on Vercel **and** this stack is reachable.

## Host

Always-on VM with a public IPv4, UDP/TCP 5060, TLS 5061, HTTPS 443 (WSS `/ws` to Kamailio on loopback 8080), and RTP `${RTP_START}`–`${RTP_END}`. Terminate TLS on nginx/Caddy as `sip.<domain>`.

## Run

```bash
cp .env.example .env
# set PUBLIC_IP, SIP_EDGE_SECRET, VOCIVO_API_URL, Telnyx gateway credentials
docker compose up -d
```

`SIP_EDGE_SECRET` must match Vercel. Kamailio authenticates REGISTER against `POST /api/voice/sip-auth`. Missed contacts call `POST /api/voice/sip-wakeup` (APNs VoIP + web push), then wait for REGISTER before 480.

Registered web E.164 INVITEs are bridged to `sofia/gateway/telnyx/+E164`. FreeSWITCH `public` treats numbers from this host as outbound origination; numbers arriving from Telnyx stay on the inbound DID path.

## Telnyx trunk

Companies add their own SIP numbers in Admin → Phone numbers. Those DIDs inbound on this host (`source: sip_trunk`) with **no Vocivo wallet charge**. Point the carrier at `sip.vocivo.app:5060` (UDP/TCP). Vocivo IVR, queues, and the DTMF receptionist run in FreeSWITCH. Telnyx Call Control remains only for Vocivo-purchased numbers that have not been moved with `VOCIVO_SIP_INBOUND=1`.

Keep `VOCIVO_SIP_INBOUND=0` unless you also move a Telnyx-owned DID onto this IP connection.

Outbound E.164 from registered clients is bridged to `sofia/gateway/telnyx/+E164`. Internal extension INVITEs stay in Kamailio usrloc.

## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Vocivo native SIP + CallKit for origination and internal legs when `VOCIVO_VOICE_EDGE=sip`. Inbound DIDs stay on Telnyx Call Control. Telnyx SDK remains the fallback if the native module is not linked.
