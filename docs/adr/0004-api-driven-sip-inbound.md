# ADR 0004: API-driven inbound dialplan on the SIP edge

- Status: Accepted
- Date: 2026-09-02

## Context

ADR 0003 moved internal and outbound calls onto the self-hosted SIP edge but left inbound DIDs on Telnyx Call
Control, because IVR, queues, voicemail and office hours only existed as Call Control commands in
`voice-webhook.ts`. Flipping `VOCIVO_SIP_INBOUND=1` therefore traded per-leg carrier billing for losing the whole
inbound feature set: `lookupSipInbound` could only fork a DID to registered contacts.

Re-implementing that logic as static FreeSWITCH XML would duplicate routing rules that already live, validated and
tenant-scoped, in the PBX configuration, and would be untestable outside a live switch.

## Decision

1. FreeSWITCH binds `mod_xml_curl` for the `dialplan` section to `POST /api/voice/sip-dialplan`. The API renders
   the dialplan for one routing step and returns it; each step hands state to the next through `vocivo_*` channel
   variables and a `transfer` back into the `public` context, so the API stays stateless and remains the single
   control plane for both edges.
2. `sip-dialplan.ts` is a pure function of the request, the organization's PBX config, its business voice config
   and its extension directory. It mirrors the Call Control decision tree: extension DIDs, office hours, ring
   groups, queues (45-second attempts up to `maxWait`), configured IVRs, the department menu, per-user schedules,
   forwarding on busy/no-answer/unavailable with a visited set and depth cap, simultaneous ring, and voicemail.
3. Prompt audio is served by `GET /api/voice/sip-prompt/<sig>.<ext>` with a deterministic HMAC-signed URL so
   `mod_http_cache` caches per prompt; audio is rendered once (Vocivo TTS or carrier fallback) and cached in the
   object store. Voicemail recordings are uploaded by `http_put` to a signed, expiring, per-call
   `/api/voice/sip-voicemail` URL and stored through the existing voicemail store.
4. The binding is installed only when `VOCIVO_SIP_INBOUND=1`; otherwise no dialplan lookup ever leaves the host.
   Any API failure yields "not found" semantics and the static dialplan's contact fork applies.
5. The Telnyx AI receptionist has no FreeSWITCH equivalent; tenants with it enabled get the configured voice menu,
   exactly as the webhook already does when the assistant fails to start.

## Consequences

- Inbound on the SIP edge costs trunk minutes only and keeps feature parity with Call Control for routing.
- Routing changes are made once, in the API, and are unit-tested (`sip-dialplan.test.ts`) rather than proven on a
  switch.
- Each routing step is one HTTPS round trip from the droplet to Vercel; the binding timeout is 8 seconds and the
  static dialplan remains the safety net.
- Call recording, the AI receptionist, and conference joins are still Call Control features in this phase.
