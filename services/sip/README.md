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

## Isolated protocol validation

On a Linux host with Docker, run `python3 services/sip/tests/validate_edge.py`
from the repository root. The `SIP protocol validation` GitHub Actions workflow
runs the same gate for SIP changes and can be dispatched manually.

The gate reads the pinned Kamailio image from Compose and checks the complete
production configuration using `KAMAILIO_CHECK_ONLY=1`, with networking disabled
and dummy environment values. It then starts a temporary loopback-only listener
on ports 15060 and 8080 using the production ingress rules through OPTIONS.
UDP, TCP and WebSocket probes cover valid requests, missing required headers,
CSeq errors, exhausted hop counts and the WebSocket Content-Length exception.
The temporary container is removed on success or failure. Ports must be free.

The delivery phase also exercises registrar and transaction routing with local
SIP peers, including delayed registration, answer/ACK/BYE, cancellation, and
expiry. It replaces admission and media with fixtures; it does not prove live
authentication, RTP, carrier routing, or native behavior. It needs no production
credentials and does not deploy anything.

The gate reproduces the previous suspended-transaction failure before testing
180 Ringing, 200/ACK/BYE, registration after 9/20/40 seconds, late second-device
delivery, duplicate registration, concurrent callers, CANCEL, and expiry.

## Extension ringback and answer delivery

An already-registered receiver is relayed immediately. Only calls with no
contact are suspended while push wakes a device. REGISTER drains the AOR's
bounded pending-transaction queue and calls `t_continue` before forwarding the
invitation; active transactions use TSILO for additional device contacts.
The AOR lock covers contact lookup through transaction storage, so registration
cannot fall between them. Each waiting entry has its own 45-second deadline;
the queue expires independently and retains simultaneous callers.

Never append receiver branches to a transaction left in `t_suspend`:
Kamailio 5.8.4 discards responses while `T_ASYNC_SUSPENDED` remains set. That
loses both the 180 that starts web/mobile caller ringback and the receiver's
200 answer. The resumed route must not rerun `rtpengine_manage` in its failure
context, which would delete the already-created media offer.

WebRTC offers/answers use `rtcp-mux-offer rtcp-mux-require` and
`UDP/TLS/RTP/SAVPF`. The old `RTCP-MUX` flag was rejected by the running
rtpengine and did not enforce the requested multiplexing behavior.


## Clients

- Web: SIP.js over `VOCIVO_SIP_WSS_URI` when `VOCIVO_VOICE_EDGE=sip`.
- iOS: Telnyx SDK remains the default. Vocivo SIP + CallKit is used only when the native module is linked.

## Addresses, and the two mistakes that made every call end at 32 seconds

Kamailio binds `0.0.0.0` and **advertises `PUBLIC_IP:5060`** on its public
sockets (`kamailio/docker-entrypoint.sh` renders `/etc/kamailio/listen.cfg`).
Without the advertised address every Record-Route it added said `0.0.0.0`, and
the carrier had nowhere to send its ACK.

FreeSWITCH's `external` profile (`sip_profiles/external.xml`) is loopback-only
and **must not set `ext-sip-ip`**: 127.0.0.1 is not in sofia's `localnet.auto`,
so with it set every Contact and Via carried the public address, where no
profile listens. Kamailio additionally forces any in-dialog request for port
5080 to `127.0.0.1:5080`. Either fault alone leaves FreeSWITCH waiting for an
ACK that never arrives and hanging up when its timer expires — 32 seconds into
every answered inbound call.

Other things `kamailio.cfg` gets right that are easy to break:

- In-dialog requests (`has_totag()`) are handled *before* the INVITE block,
  so a re-INVITE (hold, ICE restart) is never treated as a new call.
- The answer's media profile is chosen for the side it travels *to*: `FLT_WS`
  marks requests from the WebSocket port, and `MANAGE_REPLY` rewrites the
  answer as DTLS-SRTP/ICE for them and plain RTP/AVP for the switch and the
  carrier. A web phone's Contact is aliased on replies too.
- `sounds/hold-music.wav` is what callers hear while waiting; the API's
  dialplan names it as `ringback` and `hold_music`.

`Ops · Droplets → call-trace` prints the receptionist's turn timings, FreeSWITCH
hangups and Kamailio's INVITE/ACK/BYE path for the last calls; `logs` is the
general log. GitHub keeps ten annotations per step, so both are kept compact.

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

## Diagnostic accuracy and expired authentication

Use `gh workflow run ops-sip-edge.yml -f action=call-trace -f host=sip`.
The default window is two hours; `-f since=30m` changes the container-log window.
FreeSWITCH file output is a bounded tail and can contain older startup entries.
The action does not query the database or automatically correlate a SIP Call-ID.
Its Kamailio filter includes ACK/UPDATE/PRACK and preserves rejections from the
listed carrier/loopback sources without using unsupported grep lookahead.

For media diagnostics use `docker compose logs --since 10m rtpengine coturn`
from the deployed SIP directory. RTPEngine performs WebRTC/carrier media
interoperation; coturn provides STUN/TURN relay connectivity. No matching errors
is not evidence of two-way RTP. The `internal` FreeSWITCH profile is disabled;
inspect `sofia status` and trace the active `external` or `trunk` profile for the
leg under investigation. Packet capture, profile tracing, and two-way audio
acceptance require a bounded reproduction on the host and actual clients.

The matching auth API reports a verified expired Digest with `stale: true`.
Kamailio returns a fresh nonce with `stale=true`, allowing SIP.js's bounded stale
challenge retry. It resets challenge variables for each request and rejects
missing/malformed nonce responses with 503. Replay, identity, and current-access
checks remain enforced. This is local code coverage until the changed config has
passed the pinned Kamailio parser and a REGISTER/401/REGISTER/200 wire test.

## WSS connectivity diagnostics

Run `gh workflow run sip-connectivity.yml` for read-only proxy directives,
listener/firewall status and aggregate Nginx/Kamailio error categories. It excludes
credentials and raw SIP packets. Transport correlation uses the last REGISTER on
each worker and is diagnostic evidence, not proof of client identity. DigitalOcean
cloud firewall rules need separate access. `call-trace` continues past empty or
unavailable service logs and labels those sections, rather than aborting before
Kamailio output. An empty section must not be read as a healthy service.

## Authentication service failures

AUTH and CHALLENGE require the expected HTTP status and valid decision/nonce
JSON. Kamailio's HTTP client can return a positive libcurl error (28 for a
timeout); it is not an HTTP success or a wrong password. Unavailable or invalid
responses return SIP 503, without minting another nonce or advertising a password
challenge. Only a valid HTTP 403 / `ok:false` response reaches Digest recovery.
The loopback auth phase of `validate_edge.py` exercises these production routes,
including timeout/recovery, stale nonce, and malformed or inconsistent responses.

## Inbound audio diagnostics

The `Inbound audio diagnostics` workflow accepts a FreeSWITCH channel UUID.
It reads the retained call log, receptionist stages, runtime RTP port range,
selected SDP media fields and PCM statistics for the exact greeting files used.
It does not place calls, restart services, alter routing or export caller audio.
Missing retained logs are reported as missing evidence. File energy and playback
commands do not establish that RTP reached the caller; confirm with a handset
and, where necessary, live media counters or a scoped capture.
