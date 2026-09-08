> Current tenant-owned carrier setup and activation are documented in the
> [BYOC runbook](runbooks/tenant-carrier-trunks.md). The managed integration
> notes below describe the legacy path.

# Production Voice Architecture

Vocivo uses Telnyx as its managed signaling, media, ICE/TURN, native push, PSTN, and DID provider. The production control plane consists of the Vercel Node.js API and the Postgres-backed multi-tenant data layer.

There is no Vocivo-hosted registrar, event listener, relay, SBC, or media node in this release. Do not publish retired deployment ports or use a legacy tenant SIP domain.

## Internal Calling

Every active company extension owns a tenant-bound Telnyx telephony credential. Internal destinations are accepted only in the form `sip:<credential-user>@sip.telnyx.com`, and the route API verifies that both extensions belong to the authenticated organization before issuing a route authorization.

## External Trunks

Customer trunk settings are control-plane records and do not make Vocivo a carrier. Public numbers and PSTN routes must remain attached to a licensed provider such as Telnyx or an approved regional carrier. Carrier credentials must stay server-side and tenant-scoped.

## Deployment

Use the root `deploy-production.sh` script. It validates the API, web client, and mobile TypeScript, then deploys only the web/API project to Vercel. `services/pbx/docker-compose.yml` is intentionally empty so legacy media containers cannot be started accidentally.
