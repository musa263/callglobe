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
