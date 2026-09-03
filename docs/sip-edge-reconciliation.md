# Reconciling the repo with the live SIP edge

Date: 2 September 2026 · Host: `vocivo-sip` (168.144.183.82) · Deployment: `/opt/vocivo/sip`

## What happened

`services/sip` in this repository did not describe the SIP edge that is actually running. The droplet has no
git checkout at all — the stack was copied to `/opt/vocivo/sip` on 31 August and edited in place since. The two
had drifted far enough apart that deploying the repo's configuration would have **regressed production**.

This commit imports the live configuration verbatim, so the repo is the truth again. Nothing on the droplet was
changed. The tree was retrieved with `Ops · Droplets → dump-config` and verified byte-for-byte after import.

## What the live edge has that the repo did not

| Area | Live behaviour |
|---|---|
| Outbound authorisation | E.164 INVITEs are accepted **only** on the internal WebSocket port (8080, behind nginx) **and** only after Digest auth via `/api/voice/sip-auth`. Everything else gets `403`. |
| FreeSWITCH exposure | The external profile binds `127.0.0.1:5080` — FreeSWITCH is not reachable from the internet at all. Kamailio forwards to `127.0.0.1:5080`. |
| Registration | Persistent user location in SQLite (`usrloc-init.sql`, `kamailio-usrloc` volume, `db_mode 1`), `append_branches`, TCP-loss handling. |
| Challenge | Server-issued nonces via a `/sip-nonce` endpoint, falling back to `www_challenge`. |
| Mobile wake | `WAKEUP_NOW` + a single 8 s `async_route` wait for the device to REGISTER, and a `X-Vocivo-Call-UUID` header from the wake response. Comments record that looping the async route killed real calls at `tries=13`. |
| Conferences | `conf-*` targets, `REFER`/`NOTIFY` handling, attended transfer into a conference. |
| Media | Per-leg RTPEngine profiles: `ICE=force DTLS=passive SDES-off RTCP-MUX RTP/SAVPF` toward clients, plain `RTP/AVP` toward FreeSWITCH. |
| Scanner defence | Numeric `From` users on UDP are rejected before spending an auth round-trip; `sanity_check` is skipped for WebSocket frames because it was 400-ing native iOS REGISTER. |
| TURN | A `coturn` service on 3478 with `--use-auth-secret` and private ranges denied. |
| Billing hook | `sip-hangup.sh` fired from `api_hangup_hook` with route id, uuid and `billsec`. |
| Inbound | A curl-driven plan against `/api/voice/sip-inbound` with `closed` / `ivr` / `ai` / `queue` / `bridge` actions, DTMF gathering via `play_and_get_digits`, prompts spoken with `flite`. |

## Two problems this uncovered

**1. The deployed inbound dialplan and the deployed API disagree.**
`freeswitch/dialplan/public.xml` branches on `"action":"closed|ivr|ai|queue|bridge"` in the `/api/voice/sip-inbound`
response. `frontend/api/_lib/sip-inbound.ts` returns `{enabled, reason, organizationId, usernames, bridge}` and has
no `action` field at all. With today's API every inbound call would fall through to `vocivo-inbound-unroutable`
and answer `480`. The server half of that richer design was never merged here.

This is latent, not live: `X-Vocivo-Flow: inbound` is never set by Kamailio, and Kamailio rejects E.164 INVITEs
on public 5060, so no call can reach that dialplan today. It becomes real the moment inbound is switched on.

**2. `/sip-nonce` is not served.**
Live Kamailio's `CHALLENGE` route calls `http://127.0.0.1:8081/sip-nonce`, but `nginx/edge-api.conf` proxies only
`/sip-auth` and `/sip-wakeup`, and no `sip-nonce` route exists in the API. The route degrades to `www_challenge`,
so registration works — it just logs an error on every challenge and gives up server-issued nonces.

## What this means for the inbound project (ADR 0004)

ADR 0004 specified inbound via `mod_xml_curl`, asking the API for a dialplan document at each stage. That work is
built and unit-tested on the API side (`frontend/api/_lib/sip-dialplan.ts` and its route, prompt and voicemail
endpoints) but its FreeSWITCH half — `autoload_configs/xml_curl.conf.xml` and the entrypoint hook — was never
deployed, and is removed from `services/sip` by this import. It remains in git history at `e51204e~1`.

There are now two competing inbound designs. Before any DID is moved, one has to win:

- **Extend the curl design that is already deployed** — add `action` to `/api/voice/sip-inbound` so the live
  dialplan works. Smaller change, keeps the running edge as-is, but the routing logic stays split between XML
  regexes and the API.
- **Finish the `mod_xml_curl` design** — restore the removed files, enable the modules, and route every stage
  through `renderSipDialplan`, which already mirrors the Call Control webhook and is unit-tested. More faithful
  to ADR 0004 and to feature parity, but it replaces a working dialplan on a production host.

Either way the carrier path is the same and is **not** what the earlier runbook said: FreeSWITCH is loopback-only,
so Telnyx must keep delivering to Kamailio on 5060, and Kamailio must learn to accept the carrier's signalling
addresses and tag those INVITEs `X-Vocivo-Flow: inbound`. Pointing a DID at port 5080 would black-hole it.

## Correction to an earlier assessment

While reviewing the repo's `kamailio.cfg` I reported that the edge accepted unauthenticated INVITEs and was
exposed to toll fraud, and committed a fix for it (`e51204e`). That was true of the **repository's** configuration,
not of the running system: the live config already restricts E.164 origination to the authenticated WebSocket
port. The exposure would have been created by deploying the repo, not by leaving the droplet alone. The fix is
superseded by this import and the live approach is stricter than mine was.

## Update — 3 September 2026

Three things changed since the import, and one of them was a real fault sitting in the deployed dialplan.

### `public.xml` is not valid XML

The two `curl` actions in `vocivo-inbound-did` and `vocivo-inbound-menu` write their JSON bodies as
`data="... {\"to\":\"${vocivo_did}\"}"`. A backslash does not escape a quote inside an XML attribute — the
first `"` ends the attribute, whatever precedes it. `xml.etree` refuses the file at line 37, and so would
FreeSWITCH's parser.

This has gone unnoticed for the same reason problem 1 above is latent: inbound is off, so nothing exercises those
extensions. But a parser rejects a *file*, not an extension. The day `VOCIVO_SIP_INBOUND` was switched to 1 and
FreeSWITCH reloaded, it would have lost the whole `public` context — conferences and outbound PSTN included, not
just the inbound branches.

Fixed by using `&quot;`. The quality gates now parse every FreeSWITCH XML file on every push, and `sync-config`
re-checks before it ships anything.

### Nothing in this repository ever reached the droplet

The import made the repo describe the live edge, but there was still no way for a change here to become a change
there — `Ops · Droplets → deploy` only runs `docker compose up` against whatever is already on the box. That is
why a malformed dialplan could sit in the repo without consequence, and it would have made the AI receptionist
below undeployable.

`Ops · Droplets → sync-config` now ships `services/sip`, after checking every XML file parses, keeping `.env`
(the one file that is not in the repo), taking a timestamped backup under `/opt/vocivo/sip-backups/`, and rolling
back if `docker compose config` rejects the result.

### The AI receptionist is no longer a carrier feature

`sip-dialplan.ts` carried the line *"The Telnyx AI receptionist has no FreeSWITCH equivalent yet"*. It now has
one: `services/receptionist`, reached from the dialplan with `socket 127.0.0.1:8084 async full` — a stock
FreeSWITCH module, so there is no custom build to maintain.

Both inbound designs were given the hook, because either may end up winning: `vocivo-inbound-ai` in the deployed
`public.xml`, and a `receptionistActions` branch in `renderSipDialplan`. In both cases the actions after the
socket run only if the service could not be reached, so an unreachable receptionist degrades to the voice menu
rather than to silence.

What that leaves outside Vocivo's own hardware, for an answered call: one HTTPS request per conversational turn
to a language model. Telephony, speech recognition and the voice are all local. The trunk and the DID remain a
carrier service, which is the intended arrangement — the point was never to stop buying numbers, it was to stop
paying per minute for calls that never leave the tenant.

