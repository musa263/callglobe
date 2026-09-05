# Vocivo SIP API

These handlers serve Vocivo's Kamailio/FreeSWITCH edge, not the Telnyx SDK.

| Entry | Responsibility |
| --- | --- |
| `voice-sip-credentials` | Issue the authenticated extension's temporary credential and ICE configuration |
| `voice-sip-nonce`, `voice-sip-auth` | Challenge Digest registration, verify identity and consume replay evidence |
| `sip-registration-auth::ownsSipRegistration` | Bind Digest username, From/To identity, realm and requested registration URI |
| `sip-credential-store` | Store/select only live credentials; allow safe credential overlap during renewal |
| `sip-call-authorization` | Validate signed call-route ownership before call admission |
| `voice-sip-inbound`, `voice-sip-dialplan` | Resolve inbound DID tenant and render its FreeSWITCH routing instructions |
| `voice-sip-wakeup` | Resolve destination devices and dispatch bounded native/Web Push wakeups |
| `voice-sip-cdr`, `voice-sip-hangup` | Record edge events and explicitly terminate a retained inbound leg |
| `voice-sip-prompt`, `voice-sip-voicemail` | Provide authorized spoken prompts and voicemail callbacks |

Edge callbacks require `sip-edge-auth`; customer APIs require the user's session.
No unknown DID or absent tenant is permission to select a default customer.
The corresponding server implementation is `services/sip/kamailio/kamailio.cfg`.
Strict registration identity changes must ship with that config before API promotion.

Run frontend tests/typecheck. `sip-config.test.ts` is a structural guard, not a
Kamailio parser or real SIP-wire test; validate staged config in the pinned image.
