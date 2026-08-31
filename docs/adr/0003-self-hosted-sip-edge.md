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
4. **Bring-your-own SIP numbers** (`source: sip_trunk`) inbound on Kamailio/FreeSWITCH with **no tenant wallet charge**. Companies point any carrier DID at `sip.vocivo.app`. Vocivo owns IVR, queues, and the DTMF AI receptionist on that edge. Telnyx-owned Call Control numbers stay on the Voice API until `VOCIVO_SIP_INBOUND=1`. Incoming minutes are never debited from a Vocivo wallet. `+18447161777` is not the inbound product line.

## Consequences

- Production TestFlight remains on Telnyx park + Call Control for killed-state iOS inbound until Vocivo VoIP push ships.
- Internal media on the SIP edge does not traverse Telnyx.
- PSTN on the SIP edge is SIP origination + carrier minutes, not Call Control Dial/bridge.
- Conversational LLM audio is not on the SIP edge yet; the Vocivo “AI receptionist” is a company greeting plus DTMF transfer to the team.
- Flipping Telnyx-owned numbers onto the FQDN trunk is a later operator step. Customer SIP numbers inbound immediately when assigned as `sip_trunk`.
