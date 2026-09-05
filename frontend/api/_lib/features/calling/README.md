# Calling Control Plane

`routes/voice-route.ts` validates caller/destination ownership, entitlements and
call policy, then issues the selected engine's signed route. `voice-provider.ts`
selects SIP only for `VOCIVO_VOICE_EDGE=sip`. `voice-route-token.ts` signs and
validates grants; route IDs/idempotency helpers keep retries from creating new calls.

For Telnyx managed calls, `routes/voice-webhook.ts` dispatches events and
`webhook/parked-client-handler.ts` starts destination legs. `outbound-call-store.ts`
tracks related legs and claims the answered winner. `outbound-bridge.ts` and
`outbound-native-bridge.ts` perform bridging; `outbound-cancel.ts` retains failed
termination work for retry. Route/pair stores arbitrate concurrent state updates.

For Vocivo SIP, the route is consumed by Kamailio. See the sibling `sip/` feature
and `services/sip/`; Telnyx webhook changes do not fix SIP.js transport failures.

History, voicemail, queue, preferences, transfer and conference modules each own
their named behavior; their HTTP boundaries are in `routes/`. The SIP edge rejects
conference admission until a tenant-safe admission flow exists, even though the
managed provider has conference control code.

Test route authorization, duplicate/late events, first-answer arbitration,
cancel failure and history accounting with frontend `npm test`. Browser state is
tested separately under `frontend/scripts/test-sip-ui.mjs`.
