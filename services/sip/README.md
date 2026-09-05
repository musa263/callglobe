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

The gateway lives on the `trunk` sofia profile (`sip_profiles/trunk.xml`), bound to `PUBLIC_IP:5082`, not on
`external`: `external` is bound to loopback so the switch cannot be reached from the internet, and a socket bound
to loopback cannot send to the carrier either — with the gateway there it pinged itself DOWN and every outbound
bridge failed with "Gateway is down". `trunk` refuses any new INVITE that does not come from loopback
(`apply-inbound-acl=loopback.auto`); it only ever carries the calls it started. Inbound from the carrier arrives
at Kamailio on 5060. `sofia status gateway telnyx` should say `State UP`.

Inbound DIDs stay on the existing Call Control application until `VOCIVO_SIP_INBOUND=1` on both Vercel and this host. See [ADR 0003](../../docs/adr/0003-self-hosted-sip-edge.md).

## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Telnyx SDK remains the default. Vocivo SIP + CallKit is used only when the native module is linked.

## Inbound over the trunk

Kamailio tags a call it accepted from the carrier with `X-Vocivo-Flow: inbound` and forwards it to FreeSWITCH
on loopback, like every other call. FreeSWITCH asks the API for the dialplan through `mod_xml_curl`
(`autoload_configs/xml_curl.conf.xml`, installed by the entrypoint while `VOCIVO_SIP_INBOUND=1`): office
hours, voice menus, ring groups, queues, the receptionist and voicemail are rendered by
`frontend/api/_lib/features/sip/sip-dialplan.ts`, prompts stream from `/api/voice/sip-prompt` in Vocivo's own voice, and
voicemail is pushed back with `http_put`. When the binding gives no answer the static `vocivo-inbound-*`
extensions in `dialplan/public.xml` ask `/api/voice/sip-inbound` for a single routing decision instead.
`Ops · Droplets → status` lists the FreeSWITCH modules this needs; each must say `true`.

Two switches, both off by default, and a call is only accepted when both are on:

- `VOCIVO_SIP_INBOUND=1` — also set on the API (Vercel), which is what makes
  `/api/voice/sip-inbound` return a routing `action` instead of `call_control`.
- `VOCIVO_TRUNK_SOURCES` — the carrier's signalling addresses and ranges,
  comma- or space-separated. Anything not on this list sending an E.164 INVITE
  to public 5060 is refused, because that is what toll fraud looks like.

Telnyx publishes its SIP signalling ranges per region
([support.telnyx.com](https://support.telnyx.com/en/articles/1130687-whitelisting-telnyx-ip-addresses)).
For a US account the calls actually arrive from the region's **SIP IPs** — the first
inbound call came from `192.76.120.10`, which is not inside the address pools —
so list those as well as the pools:

```
VOCIVO_TRUNK_SOURCES=192.76.120.10,64.16.250.10,192.76.120.128/26,192.76.120.192/27,64.16.250.0/24
```

Add the EMEA (`185.246.41.0/26`) or APAC (`103.115.244.0/26`) range only if the
account's numbers are anchored there — every range added is a range that may
originate a call on the account.

The list is rendered into `/etc/kamailio/trunk-sources.cfg` at container start
and included by `kamailio.cfg`, so `docker compose logs kamailio` reports how
many entries were accepted and names any it could not parse.
