# ADR 0003: Self-hosted SIP edge, Telnyx as PSTN trunk

- Status: Accepted
- Date: 2026-08-31

## Context

Internal and PSTN calls still park on Telnyx WebRTC and Dial through Call Control. That keeps CallKit and push working, but Telnyx bills platform legs even for colleague-to-colleague calls. Vocivo now owns a SIP registrar (Kamailio + RTPEngine + FreeSWITCH) so Telnyx can be reduced to Elastic SIP trunking.

Inbound IVR, queues, voicemail, AI receptionist, and conferences already live in Call Control webhooks. Moving them in the same cut as CallKit replacement is how the app broke before.

## Decision

1. Ship `services/sip` as the Vocivo SIP edge. Internal AORs fork registered contacts. Outbound E.164 bridges to the Telnyx SIP gateway.
2. Default `VOCIVO_VOICE_EDGE=telnyx`. Web SIP.js and iOS native SIP are used only when the flag is `sip`.
3. iOS uses the Vocivo SIP CallKit module for origination and internal SIP when `VOCIVO_VOICE_EDGE=sip`. Inbound DIDs stay on Telnyx Call Control / PushKit. Do not replace Telnyx’s VoIP push registry.
4. Inbound DIDs stay on the Telnyx Call Control application until `VOCIVO_SIP_INBOUND=1` **and** the DID is assigned to the droplet IP connection. FreeSWITCH then looks up `/api/voice/sip-inbound` and forks extension contacts. IVR/queue/voicemail destination types stay on Call Control even when the flag is on.

## Consequences

- Production TestFlight remains on Telnyx park + Call Control.
- Internal media on the SIP edge does not traverse Telnyx.
- PSTN on the SIP edge is SIP origination + carrier minutes, not Call Control Dial/bridge.
- Flipping numbers onto the FQDN trunk is a later operator step after web SIP and killed-state ring pass.
