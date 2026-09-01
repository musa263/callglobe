# Production Voice Architecture

Vocivo uses Telnyx as its managed signaling, media, ICE/TURN, native push, PSTN, and DID provider. The production control plane consists of the Vercel Node.js API and the Postgres-backed multi-tenant data layer.

There is no Vocivo-hosted registrar, event listener, relay, SBC, or media node in this release. Do not publish retired deployment ports or use a legacy tenant SIP domain.

## Internal Calling

Every active company extension owns a tenant-bound Telnyx telephony credential. Internal destinations are accepted only in the form `sip:<credential-user>@sip.telnyx.com`, and the route API verifies that both extensions belong to the authenticated organization before issuing a route authorization.

## External Trunks

Customer trunk settings are control-plane records. Companies bring a DID from any SIP provider, assign it as a Vocivo `sip_trunk` number, and send inbound INVITEs to `sip.vocivo.app`. Incoming calls are free on the Vocivo wallet. IVR, queues, and the DTMF receptionist run on the Vocivo SIP edge. Outbound PSTN still uses a licensed trunk (Telnyx or the customer’s own outbound carrier) and is the only voice usage billed to calling credit.

Do not attach customer inbound to Telnyx Call Control if the goal is zero inbound platform fees.

## Deployment

Use the root `deploy-production.sh` script. It validates the API, web client, and mobile TypeScript, then deploys only the web/API project to Vercel. `services/pbx/docker-compose.yml` is intentionally empty so legacy media containers cannot be started accidentally.
