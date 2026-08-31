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

Registered web E.164 INVITEs are bridged to `sofia/gateway/telnyx/+E164`. FreeSWITCH `public` treats numbers from this host as outbound origination; numbers arriving from Telnyx stay on the inbound DID path.

## Telnyx trunk

Outbound PSTN uses a Telnyx **credential** SIP connection (`TELNYX_SIP_USERNAME` / `TELNYX_SIP_PASSWORD`). Telnyx challenges INVITEs with 407; Sofia must answer with those credentials. An empty username becomes `FreeSWITCH` and Telnyx returns 403. Keep the DID on the Call Control application for inbound IVR, queues, and voicemail. Extension and main-line DIDs can move onto this host after `VOCIVO_SIP_INBOUND=1`. Outbound E.164 from registered clients is bridged to `sofia/gateway/telnyx/+E164`. Internal extension INVITEs stay in Kamailio usrloc and are never sent to Telnyx as SIP URIs.

Inbound DIDs stay on the existing Call Control application until `VOCIVO_SIP_INBOUND=1` on both Vercel and this host. See [ADR 0003](../../docs/adr/0003-self-hosted-sip-edge.md).

## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Telnyx SDK remains the default. Vocivo SIP + CallKit is used only when the native module is linked.
