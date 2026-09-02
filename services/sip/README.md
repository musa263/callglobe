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

`SIP_EDGE_SECRET` must match Vercel. Kamailio authenticates REGISTER against `POST /api/voice/sip-auth`. Missed contacts call `POST /api/voice/sip-wakeup`.

## Telnyx trunk

Create an FQDN or IP connection in Mission Control pointing at this host. Put the SIP username/password (or IP ACL) in `.env`. Outbound E.164 from registered clients is bridged to `sofia/gateway/telnyx/+E164`.

Inbound DIDs stay on the existing Call Control application until `VOCIVO_SIP_INBOUND=1` on both Vercel and this host. See [ADR 0003](../../docs/adr/0003-self-hosted-sip-edge.md).

## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Telnyx SDK remains the default. Vocivo SIP + CallKit is used only when the native module is linked.
