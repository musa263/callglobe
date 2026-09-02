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

Create an FQDN or IP connection in Mission Control pointing at this host. Put the SIP username/password (or IP ACL) in `.env`. Outbound E.164 from registered clients is bridged to `sofia/gateway/telnyx/+E164`.

Inbound DIDs stay on the existing Call Control application until `VOCIVO_SIP_INBOUND=1` on both Vercel and this host. See [ADR 0003](../../docs/adr/0003-self-hosted-sip-edge.md).

## Inbound on the edge (`VOCIVO_SIP_INBOUND=1`)

With the flag on, `docker-entrypoint.sh` installs a `mod_xml_curl` dialplan binding and FreeSWITCH asks the
Vocivo API (`POST /api/voice/sip-dialplan`, HTTP Basic `vocivo:<SIP_EDGE_SECRET>`) what to do with every inbound
DID at every step: office hours, the department voice menu or a configured IVR, ring groups, queues, per-user
forwarding and simultaneous ring, and voicemail. The logic lives in `frontend/api/_lib/sip-dialplan.ts` and mirrors
the Call Control webhook, so both edges route identically from the same PBX configuration. See
[ADR 0004](../../docs/adr/0004-api-driven-sip-inbound.md).

- Prompts are fetched as `http_cache://<api>/api/voice/sip-prompt/...` (signed, cached in the object store); the
  API renders them with the Vocivo TTS service when `TTS_SERVICE_URL` is set, otherwise with the carrier voice.
- Voicemail is recorded to `VOCIVO_SIP_RECORDINGS_DIR` and pushed with `http_put` to a signed, single-call
  `/api/voice/sip-voicemail` URL, then deleted locally.
- Any API failure or "not found" falls through to the static `dialplan/public.xml`, which forks to registered
  contacts via `/api/voice/sip-inbound` — the pre-existing behaviour.

Requirements on this host: `mod_xml_curl`, `mod_http_cache` and `mod_shout` (all in `freeswitch-meta-all`; the
entrypoint enables them). `SIP_EDGE_SECRET` must be URL-safe (base64url characters) because it is substituted into
XML and used as an HTTP Basic password. On Vercel set `VOCIVO_SIP_INBOUND=1`, and make sure `VITE_APP_URL` is the
public API origin FreeSWITCH can reach.

Verify on the droplet before moving any DID: `fs_cli -x "xml_curl debug_on"`, place a test call to a DID assigned
to the tenant, and confirm the fetched document in the FreeSWITCH log; then confirm a prompt plays (`http_cache`)
and a voicemail lands in the admin console.

## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Telnyx SDK remains the default. Vocivo SIP + CallKit is used only when the native module is linked.
