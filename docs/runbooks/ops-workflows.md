# Ops workflows

Manual GitHub Actions for operating Vocivo's infrastructure from one place, with credentials kept in GitHub's
encrypted secrets store. Every action is an allowlisted script — no workflow accepts free-form commands — and every
run is an auditable log. Trigger them from **Actions → Ops · …** in the repository, or with the GitHub API
(`POST /repos/musa263/vocivo/actions/workflows/<file>/dispatches`).

## One-time setup

Repository → **Settings → Secrets and variables → Actions**.

| Secret | Used by | How to get it |
|---|---|---|
| `VERCEL_TOKEN` | Ops · Vercel | vercel.com → Account Settings → Tokens. Scope: **musa263's projects** (the team). A project-scoped token cannot read project settings and the CLI fails with "Could not retrieve Project Settings". |
| `TELNYX_API_KEY` | Ops · Telnyx | Telnyx Mission Control → Auth → API Keys. |
| `OPS_SSH_KEY` | Ops · Droplets | Private half of a dedicated key: `ssh-keygen -t ed25519 -f ~/.ssh/vocivo-ops -N ""`, then `ssh-copy-id -i ~/.ssh/vocivo-ops.pub root@<droplet>` for each droplet, then paste the contents of `~/.ssh/vocivo-ops`. If the droplet only accepts key logins (`ssh-copy-id` → "Permission denied (publickey)"), append the public key to `/root/.ssh/authorized_keys` from the DigitalOcean web console instead. |
| `SIP_EDGE_HOST` | Ops · Droplets | `168.144.183.82` (vocivo-sip) |
| `PBX_HOST` | Ops · Droplets | `68.183.244.215` (vocivo-pbx-01b), optional |
| `TTS_SERVICE_SECRET` | Ops · Droplets (tts-deploy) | `openssl rand -hex 32`. Set the **same value** on Vercel with Ops · Vercel → set. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`, `APNS_TOPIC` | Ops · Vercel (sync-push-credentials) | Apple Developer → Keys → a key with APNs enabled. `APNS_AUTH_KEY` is the whole `.p8`, `APNS_TOPIC` is the bundle id (`app.vocivo.mobile`). |
| `FCM_SERVICE_ACCOUNT` | Ops · Vercel (sync-push-credentials) | Firebase → Project settings → Service accounts → Generate new private key; the whole JSON. |

Every one of these workflows can also be started through the API, for the times the **Run workflow** form
will not load (it failed to for a quarter of an hour on 3 September while the edge was down). A fine-grained
token with *Contents: read and write* on the repository is enough:

```bash
curl -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/musa263/vocivo/dispatches \
  -d '{"event_type":"ops-sip-edge","client_payload":{"action":"status","host":"sip"}}'
```

`event_type` is `ops-sip-edge`, `ops-vercel`, `ops-telnyx` or `ops-mobile`; the `client_payload` keys are the form's inputs
by name (`environment` and `host` default to `production` and `sip`; pass `"redeploy": true` explicitly for a
Vercel `set`). Anything but a listed action is refused. A 204 means the run was queued; find it under
`GET /repos/musa263/vocivo/actions/workflows/<file>/runs?event=repository_dispatch`.

Variables (same page, *Variables* tab, all optional): `OPS_SSH_USER` (default `root`), `SIP_EDGE_REPO_DIR`
(auto-discovered when unset), `TTS_PUBLIC_BASE_URL` (https URL the TTS service is served at).

Rotate any token that has ever been pasted into a chat or a terminal history; these workflows only ever read
them from the secrets store.

## Ops · Vercel

| action | effect |
|---|---|
| `show` | Prints the variable's value **only** if it is on the non-secret allowlist (`VOCIVO_VOICE_EDGE`, `VOCIVO_SIP_INBOUND`, SIP domain/realm/WSS, `VITE_APP_URL`, `TTS_SERVICE_URL`, push identifiers); otherwise just "set" / "not set". |
| `set` | Replaces the variable in the chosen environment(s), then redeploys production (uncheck *redeploy* to batch several changes). |
| `delete` | Removes the variable. |
| `redeploy` | Production deploy from `main`, then polls `/api/health`. |
| `sync-push-credentials` | Copies the mobile push credentials (`APNS_*`, `FCM_SERVICE_ACCOUNT`) from the GitHub secrets store into Vercel and redeploys. They are read from secrets rather than taken as an input, because `workflow_dispatch` inputs are visible in the run's metadata to anyone who can read the repository. Missing ones are reported and skipped. |

## Ops · Droplets

| action | effect |
|---|---|
| `discover` | Read-only survey of an unfamiliar droplet: OS, containers, compose projects and files, git checkouts, listening ports, host services, firewall. Run this first when `status` reports `repo: NOT FOUND`. |
| `status` | Current commit, `VOCIVO_SIP_INBOUND` flag, env key names, container state, `sofia status`. |
| `logs` | Last 200 lines from FreeSWITCH, Kamailio and RTPEngine. |
| `deploy` | Pulls images and `docker compose up -d`. On `vocivo-sip` there is **no git checkout**, so nothing is pulled from source and config changes are not delivered this way — the action says so in its output. |
| `sync-config` | Ships `services/sip` from the checked-out commit to `/opt/vocivo/sip`, keeping the droplet's `.env`. Before anything is swapped it checks that every module `kamailio.cfg` loads exists in the pinned Kamailio image, and it backs the live tree up to `/opt/vocivo/sip-backups/<timestamp>` first; a compose file the droplet rejects is rolled back automatically, and Kamailio's own parser must accept the rendered configuration. FreeSWITCH and then Kamailio are recreated so the shipped files are live (the config is bind-mounted, so compose alone would not restart them). This is how configuration reaches `vocivo-sip`. |
| `rollback-config` | Restores the newest backup over `/opt/vocivo/sip` (keeping `.env`) and recreates the containers. |
| `enable-inbound` / `disable-inbound` | Flips `VOCIVO_SIP_INBOUND` in the edge `.env` and recreates Kamailio and then FreeSWITCH, checking that Kamailio came back. `enable-inbound` also needs `trunk_sources`: the carrier's SIP signalling addresses and ranges, comma-separated (Telnyx US: `192.76.120.10,64.16.250.10,192.76.120.128/26,192.76.120.192/27,64.16.250.0/24` — the two single addresses are the region's SIP IPs, which is where the calls actually come from). They are validated on the runner and written to `VOCIVO_TRUNK_SOURCES`; Kamailio accepts an E.164 INVITE on public 5060 only from those sources, and only while the flag is `1`. Flip the same flag on Vercel. |
| `tts-deploy` | Ships `services/tts` to the droplet (it is not a checkout), builds it, writes `/etc/vocivo/tts.env` from secrets, and runs the container on `127.0.0.1:8000` capped at 1.5 CPU / 2 GB so synthesis cannot starve the real-time SIP processes. When `TTS_PUBLIC_BASE_URL` has a path, it also adds an nginx `location` under the edge's existing TLS vhost, backing the vhost up and rolling back if `nginx -t` rejects it, then warms two voices (the first synthesis downloads the model and is slow). |
| `tts-status` | Container state and an unauthenticated health probe (expects 401). |

## Ops · Telnyx

| action | effect |
|---|---|
| `list-connections` | Call Control applications, FQDN/IP trunks, credential connections — with ids. |
| `show-connection` | One connection's inbound/outbound settings, its authorised IPs or FQDNs (where Telnyx will send inbound INVITEs), and the numbers on it. Run this on the trunk **before** the first `route-number` and confirm the authorised IP is the SIP edge on port **5060** (Kamailio), not 5080. |
| `set-trunk-port` | Moves every authorised IP entry on an IP trunk to `port` (5060/5061/5080). **Do not use this to move inbound to 5080 on vocivo-sip:** FreeSWITCH there binds `127.0.0.1:5080` and is unreachable from the internet, so the carrier must keep delivering to Kamailio on **5060**. See `docs/sip-edge-reconciliation.md`. |
| `list-numbers` | Every number with its current connection. |
| `show-number` | One number's routing and messaging profile. |
| `route-number` | **The cut-over.** Re-points one DID to a connection id. Pointing a DID at the FQDN/IP trunk moves its inbound calls off Call Control and onto the SIP edge — do this one number at a time, after `enable-inbound` has been verified with a test DID. |

## Cut-over order for inbound

The two inbound designs are reconciled (`docs/sip-edge-reconciliation.md`, update of 3 September 2026):
`/api/voice/sip-inbound` returns the `action` the deployed dialplan branches on, and Kamailio accepts an E.164
INVITE on public 5060 when — and only when — it comes from a listed carrier address and `VOCIVO_SIP_INBOUND=1`.

1. Ops · Vercel → `show VOCIVO_VOICE_EDGE`; set to `sip` and verify a browser call (internal, then outbound).
2. Ops · Droplets → `sync-config` (ships the Kamailio config that knows about the carrier), then `status`
   (confirm Kamailio on 5060 and FreeSWITCH on 127.0.0.1:5080).
3. Ops · Droplets → `enable-inbound` with `trunk_sources` set to the carrier's ranges; the Kamailio log line
   `trunk sources -> N entr(ies)` in the output confirms they were rendered. Then Ops · Vercel →
   `set VOCIVO_SIP_INBOUND 1`.
4. Ops · Telnyx → `show-connection` on the IP trunk: the authorised IP must be the edge on port 5060. Then
   `route-number` for **one test DID** onto the trunk; call it; check `logs`.
5. Repeat `route-number` per DID. Roll back a DID by routing it back to the Call Control application id; roll
   the edge back with `disable-inbound` (and `rollback-config` if the shipped configuration itself is at fault).

Known ids (this account, September 2026): Call Control application `3033560124078688149` ("Vocivo Voice System"),
IP trunk `3035898149177656815` ("Vocivo Dedicated PBX" → 168.144.183.82). The account currently has a single DID.
