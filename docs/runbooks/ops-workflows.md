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

## Ops · Droplets

| action | effect |
|---|---|
| `status` | Current commit, `VOCIVO_SIP_INBOUND` flag, env key names, container state, `sofia status`. |
| `logs` | Last 200 lines from FreeSWITCH, Kamailio and RTPEngine. |
| `deploy` | `git pull --ff-only` on `main`, pull images, `docker compose up -d`. |
| `enable-inbound` / `disable-inbound` | Flips `VOCIVO_SIP_INBOUND` in the edge `.env` and recreates FreeSWITCH, then shows the module/binding log lines. Flip the same flag on Vercel. |
| `tts-deploy` | Builds `services/tts`, writes `/etc/vocivo/tts.env` from secrets, runs the container on `127.0.0.1:8000`. You still need an https reverse proxy in front of it. |
| `tts-status` | Container state and an unauthenticated health probe (expects 401). |

## Ops · Telnyx

| action | effect |
|---|---|
| `list-connections` | Call Control applications, FQDN/IP trunks, credential connections — with ids. |
| `show-connection` | One connection's inbound/outbound settings, its authorised IPs or FQDNs (where Telnyx will send inbound INVITEs), and the numbers on it. Run this on the trunk **before** the first `route-number` and confirm the IP is the SIP edge on port 5080. |
| `list-numbers` | Every number with its current connection. |
| `show-number` | One number's routing and messaging profile. |
| `route-number` | **The cut-over.** Re-points one DID to a connection id. Pointing a DID at the FQDN/IP trunk moves its inbound calls off Call Control and onto the SIP edge — do this one number at a time, after `enable-inbound` has been verified with a test DID. |

## Cut-over order for inbound

1. Ops · Vercel → `show VOCIVO_VOICE_EDGE`; set to `sip` and verify a browser call (internal, then outbound).
2. Ops · Droplets → `deploy`, then `status`.
3. Ops · Droplets → `enable-inbound`; Ops · Vercel → `set VOCIVO_SIP_INBOUND 1`.
4. Ops · Telnyx → `list-connections` to find the trunk id; `route-number` for **one test DID**; call it; check `logs`.
5. Repeat `route-number` per DID. Roll back a DID by routing it back to the Call Control application id.
