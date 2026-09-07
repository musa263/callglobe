# Vocivo Production Stabilization & Core Telecom Engineering Manual

Operational troubleshooting rulebook for Vocivo's multi-tenant, mobile-first business phone infrastructure. Covers engine selection, evidence collection, failure isolation, code ownership, remediation, and acceptance gates.

The supplied manuals identify project baseline `fca9d6f`; this document maps their scenarios to the current repository, not a verified deployment of that revision. Record the actual deployed SHA and configuration for every incident. Unresolved source markers from the supplied material are replaced with repository references below.

## 1. Operating rules

Before changing code, read `AGENTS.md`, the engineering skill at `docs/skills/vocivo-engineering/SKILL.md`, [CONTRIBUTING.md](CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md), and the owning README from [docs/FEATURES.md](docs/FEATURES.md).

- Establish the selected engine before diagnosing runtime behavior. A symptom or hangup cause is a lead, not proof of one root cause.
- Preserve user changes and collect evidence before modifying configuration. Do not manually tamper with live droplets or Vercel settings; use reviewed, reproducible deployment workflows within the authorized task.
- Resolve tenant ownership from authenticated context before accessing tenant resources. Never substitute a global default or trust a client-supplied organization ID.
- Keep authorization, route signatures, replay checks, destination policy, and ledger integrity intact during remediation.
- Use existing lifecycle, transaction, and cleanup helpers. Add regression coverage for signaling, authorization, and billing fixes.
- This rulebook does not authorize production deployments, paid calls, or external messages. Missing access or device coverage must be recorded as an acceptance limitation.

## 2. Multi-engine topology and routing controls

First inspect the affected client's authenticated `/api/voice/config` response and correlate it with the deployed environment and incident time. [voice-provider.ts](frontend/api/_lib/features/calling/voice-provider.ts) selects SIP only when the trimmed `VOCIVO_VOICE_EDGE` value is `sip`; other values select Telnyx. Both implementations exist, but that does not mean a call traverses both.

```text
Client -> /api/voice/config -> selected voice edge
  |
  +-- sip -> SIP.js / WebRTC -> Kamailio
  |                              +-- internal destination registration
  |                              +-- FreeSWITCH -> Telnyx PSTN trunk
  |                                      +-- Python receptionist -> STT / LLM / TTS
  |          Media: rtpengine; ICE relay fallback: coturn
  |
  +-- telnyx -> Telnyx client adapter -> managed carrier path
                 +-- Vocivo Call Control webhooks / call stores
```

Use manifests, lockfiles, [SIP Compose](services/sip/docker-compose.yml), and deployed evidence for versions. Do not infer production topology from an old document: [SIP_TRUNKING.md](docs/SIP_TRUNKING.md) describes a managed-only release, while the current architecture and [SIP service README](services/sip/README.md) describe selectable edges.

### Protocol perimeter

- On client-originated SIP admission, reject forged routing authority and require the implemented control-plane-signed route grant for outbound PSTN access. Preserve identity, destination, expiry, and replay validation.
- Carrier-originated inbound INVITEs must match the configured, approved trunk-source allowlist. This restriction applies to carrier ingress, not all authenticated client INVITEs. Verify current provider signaling ranges before changing the allowlist; do not copy historical ranges blindly.
- Confirm `VOCIVO_SIP_INBOUND` on both API and SIP host when diagnosing inbound trunk routing. Keep Digest registration authentication separate from call-route authorization.
- In-dialog ACK, BYE, and re-INVITE routing must preserve the established dialog rather than consume a new one-use route token.

## 3. Required incident tracing sequence

1. **Select the engine.** Capture `/api/voice/config`, platform/build SHA, deployment SHA, incident timestamp with timezone, call direction, and internal/PSTN destination class. If historical configuration cannot be established, mark engine attribution uncertain.
2. **Read the operational report.** For SIP incidents, use **Ops · Droplets → call-trace** in the [operations workflow](.github/workflows/ops-sip-edge.yml). This is an operations action, not a shell command. Read hangup causes, Kamailio INVITE/ACK/BYE progression, and receptionist turn timings. Use its `logs` and `status` actions for missing context. For managed calls, inspect API/webhook events and related Telnyx legs instead.
3. **Correlate identifiers.** Join API request/route IDs, SIP Call-ID and tags, FreeSWITCH channel UUIDs, carrier leg IDs, and AI turn timestamps where available. The compact report may omit evidence; absent lines do not prove an event never occurred.
4. **Check tenant isolation.** Trace `sessionOrganizationId`, authenticated extension, destination ownership, entitlements, and tenant-scoped persistence. For service callbacks, verify edge authentication and resolved tenant ownership through the relevant contract.
5. **Locate the first divergence.** Compare expected and observed events in order: configuration → credentials → registration → route admission → invitation → answer → media → teardown → accounting.
6. **Form and test one hypothesis.** Identify the responsible layer and evidence that would disprove the hypothesis. Apply the smallest supported change, then run the required checks.

Redact secrets, SIP Authorization headers, bearer/push tokens, message content, and full phone numbers. Keep evidence in an access-controlled incident record; avoid dumping environment variables or full proxy configuration into shared logs.

## 4. Code ownership and symptom map

Prefixes below are repository-relative: `B/` = `frontend/api/_lib/features/`, `W/` = `frontend/src/features/`, `M/` = `mobile/src/features/`.

| Concern / symptom | Primary targets | Owning guidance |
| --- | --- | --- |
| Access, wrong tenant, directory ownership | `B/auth/`, `B/organizations/`; `W/auth/`, `W/admin/`; `M/auth/`, `M/organizations/`, `M/contacts/` | [Feature directory](docs/FEATURES.md) |
| Call admission or wrong route | `B/calling/routes/voice-route.ts`, `B/calling/voice-provider.ts`, `B/sip/` | [Calling API](frontend/api/_lib/features/calling/README.md), [SIP API](frontend/api/_lib/features/sip/README.md) |
| Web registration or teardown | `W/calling/hooks/useSipVoice.js`, `W/calling/engine/sipSession.js`, `sipRegistrationKeeper.js` | [Web calling](frontend/src/features/calling/README.md) |
| Native Answer, push wake, stale call UI | `M/calling/engine/callUi.ts`, `runtime/sipNative.ts`, `state/callLifecycle.ts`, `VoiceContext.tsx`; `mobile/native/`, `mobile/plugins/` | [Mobile calling](mobile/src/features/calling/README.md) |
| Managed call bridge/cancel failures | `B/calling/routes/voice-webhook.ts`, `outbound-call-store.ts`, `outbound-cancel.ts` | [Calling API](frontend/api/_lib/features/calling/README.md) |
| Wallet or usage discrepancy | `B/billing/wallet-store.ts`, `B/calling/routes/voice-route.ts`, `B/sip/routes/voice-sip-cdr.ts` | [Billing](frontend/api/_lib/features/billing/README.md) |
| Missing or one-way audio | Client media/session engines, Kamailio `MANAGE_REPLY`, rtpengine/coturn configuration | [SIP service](services/sip/README.md) |
| AI silence, interruption, failed transfer | `B/ai/`, `B/sip/sip-dialplan.ts`, `services/receptionist/app/`, `services/tts/` | [AI API](frontend/api/_lib/features/ai/README.md), [Receptionist](services/receptionist/README.md), [TTS](services/tts/README.md) |

Public API adapters remain under `frontend/api/`. Persistent ESL/media work belongs in services. Put reproducible native changes in `mobile/native/` and `mobile/plugins/`, not generated native projects.

## 5. Failure playbooks

### A. Call drops roughly 32 seconds after answer

**Evidence:** repeated `200 OK`, a missing matching ACK on a particular leg, and a timer-related hangup such as `RECOVERY_ON_TIMER_EXPIRE`. `NORMAL_CLEARING` alone does not identify the fault.

**Investigate:** follow the ACK hop by hop using dialog identifiers. Inspect Record-Route, Contact, Via, advertised socket addresses, and the destination actually receiving the ACK. The [SIP README](services/sip/README.md) records two concrete historical faults: Kamailio advertising `0.0.0.0`, and FreeSWITCH advertising a public address for its loopback-only external profile.

**Targets:** [Kamailio configuration](services/sip/kamailio/kamailio.cfg), its [entrypoint](services/sip/kamailio/docker-entrypoint.sh), and [FreeSWITCH external profile](services/sip/freeswitch/sip_profiles/external.xml). Inspect the deployed WSS proxy only if evidence implicates that hop; Compose is not the sole source of host Nginx configuration.

**Remediate:** correct the proven advertised-address, in-dialog routing, contact alias, or WSS persistence defect. Verify Upgrade/Connection forwarding and proxy timeouts against the deployed WSS location if transport closes. Do not inject `fix_nated_contact()` or timeout changes as a universal ACK fix.

**Acceptance:** matched ACK reaches the answering leg, the call survives the former failure point, two-way media works, hold/re-INVITE works, and BYE cleans up. Validate signaling changes with regression tests and the pinned-image SIP gate.

### B. Web refresh causes registration failure or duplicate contacts

**Evidence:** capture the actual SIP response and REGISTER sequence around reload/reconnect. Distinguish SIP `403`/`482` responses from HTTP credential API errors; neither response proves duplicate contacts by itself.

**Investigate:** temporary credential expiry/generation, Digest identity/realm, registrar contacts, device identity ownership, and concurrent registration attempts. Trace `useSipVoice`, `sipSession`, and `sipRegistrationKeeper` before changing teardown.

**Remediate:** preserve serialized registration and scoped cleanup. Explicit unregister, when appropriate, must target the owned contact through the installed SIP.js API. Do not assume `userAgent.stop()` guarantees a delivered `REGISTER Expires: 0` on browser exit. Do not unregister all devices. Credential DELETE must use the exact device and credential generation so an old tab cannot revoke a newer session.

**Acceptance:** rapid reload, reconnect, credential rotation, unmount, and simultaneous tabs/devices do not revoke unrelated contacts, duplicate subscriptions, or leave unbounded retries. Confirm server-side behavior separately from browser fixture tests.

### C. Native Answer arrives before the SIP INVITE

**Evidence:** correlate push, native Answer, JS bootstrap, registration, incoming INVITE, SIP accept result, and native completion for the same call ID.

**Investigate:** [callUi.ts](mobile/src/features/calling/engine/callUi.ts) already queues pending answers and completes the native action after `bridge.answer` succeeds. [sipNative.ts](mobile/src/features/calling/runtime/sipNative.ts) owns secure registration bootstrap; [callLifecycle.ts](mobile/src/features/calling/state/callLifecycle.ts) guards lifecycle operations.

**Remediate:** repair the existing event-driven queue, identity correlation, deadline, or cancellation path. Never block the JS thread or add a second polling answer loop. The edge's documented 45-second late-registration window is not a blanket native action timeout; inspect each implemented deadline. Timeout, remote cancel, logout, and disposal must fail/finish the pending native action and remove timers. Late events must not resurrect ended calls.

**Acceptance:** Answer-before-INVITE, duplicate push/Answer, INVITE-after-timeout, cancel-before-answer, and logout races pass regression tests. Physical iOS/Android foreground, background, killed-state, audio, and network migration remain separate acceptance gates.

### D. Internal extension calls debit a wallet or enter a PSTN route

**Evidence:** correlate the route flow and selected edge with caller/destination ownership, carrier legs, ledger entries, reservation/settlement IDs, and billed duration. Separate provider cost from customer charges.

**Investigate:** [voice-route.ts](frontend/api/_lib/features/calling/routes/voice-route.ts) resolves an explicit internal flow and tenant directory target. The current numeric-extension check accepts 2–5 digits, and internal SIP identity parsing is also supported. A four-digit regex alone cannot authorize or classify an internal call.

**Remediate:** preserve caller and destination ownership, internal-calling entitlement, and account-type restrictions before issuing a route. [voiceRouteNeedsTelnyxCredit](frontend/api/_lib/features/calling/voice-provider.ts) bypasses Telnyx credit only for internal SIP-edge calls; managed-edge calls still require carrier service. Never silently fall back from an internal route to paid PSTN.

For outbound calls, preserve entitlement, destination policy, and wallet reservation before authorization. Use the existing [wallet-store](frontend/api/_lib/features/billing/wallet-store.ts) precision, atomic transaction/CAS, and idempotency contracts. Do not introduce floating-point adjustments or direct balance writes. Correct historical charges only through an authorized, auditable ledger workflow.

**Acceptance:** test tenant denial, nonexistent/inactive destinations, supported extension formats, duplicate/out-of-order accounting events, concurrent reservations, and insufficient outbound balance. Internal SIP calls must avoid carrier credit checks and customer PSTN charges; verify managed behavior separately.

### E. AI stops speaking or the call ends between turns

**Evidence:** distinguish an open silent channel from an actual hangup. Compare FreeSWITCH hangup initiator/cause with recording, STT, first-sentence, LLM, synthesis, playback completion, and interruption timestamps. A 5–8 second cutoff alone does not prove an ESL timeout.

**Investigate:** [call.py](services/receptionist/app/call.py), [esl.py](services/receptionist/app/esl.py), [brain.py](services/receptionist/app/brain.py), [speech.py](services/receptionist/app/speech.py), and [configuration](services/receptionist/app/config.py). Check TTS readiness/queueing and shared audio availability. Keep the outbound ESL listener on its configured loopback boundary (`127.0.0.1:8084` by default).

**Remediate:** preserve the existing first-sentence LLM callback and synthesized-file playback pipeline; do not replace it with an invented `tts://` ESL interface. Keep CPU-bound STT off the event loop, bound asynchronous work, correlate command completion to the correct channel, and cancel pending work on disconnect.

For barge-in, preserve caller-side recording, sustained-energy detection, playback interruption, and cancellation/invalidation of pending LLM/TTS results. Verify silence, noise, and echo; an energy gate is not proof of human speech. A stale response must never resume playback or execute an interrupted transfer.

For transfer failures, trace `vocivo_from_receptionist`, `vocivo_transfer_failed`, and [sip-dialplan.ts](frontend/api/_lib/features/sip/sip-dialplan.ts). Preserve hold music, tenant-authorized destinations, and return to the receptionist when unanswered. Follow the configured tenant fallback when the model fails.

The receptionist documents a 90-second idle-silence default. Verify the implementation and effective settings before changing timers; this is not a universal call-duration limit for every engine or a reason to reset idle state blindly on each playback.

**Acceptance:** service tests plus authorized real playback checks cover first audio, multiple turns, silence, barge-in, delayed/erroring LLM/TTS, caller hangup during work, and failed transfer return. Record measured latency and concurrency; passing stub tests does not establish live capacity.

### F. Call appears connected but audio is absent or one-way

**Investigate:** establish whether signaling completed, then inspect microphone permission, tracks and output routing, ICE candidate selection/TURN reachability, SDP codecs and direction, DTLS-SRTP negotiation, and RTP counters on each leg. For SIP, verify `MANAGE_REPLY` selects the media profile for the receiving side and rtpengine handles offer/answer updates.

**Remediate:** change only the demonstrated permission, media negotiation, address, or relay defect. A UI duration timer or SIP success response is not evidence of audible media.

**Acceptance:** two-way speech, hold/resume, teardown, and relevant Wi-Fi/cellular/Bluetooth transitions work on affected platforms. Verify TURN fallback in an appropriate test network.

## 6. Verification, promotion, and rollback

For code or configuration changes, run from the repository root:

```bash
bash verify.sh
```

The current [verify.sh](verify.sh) runs frontend API typechecking, frontend tests, the web build, mobile typechecking, and mobile tests. It does **not** run the browser scripts, Python service suites, or the isolated SIP parser/protocol gate; run those separately when affected.

| Affected layer | Additional required validation |
| --- | --- |
| Browser calling/UI | Browser scripts and running Vite setup in [CONTRIBUTING.md](CONTRIBUTING.md), including `test-sip-ui.mjs` and `test-web-startup.mjs` |
| Receptionist | In `services/receptionist`, run `python3 -m unittest discover -s tests` with service dependencies available |
| TTS | In `services/tts`, run `python3 -m unittest discover -s tests`; distinguish stub pipeline coverage from actual synthesis |
| SIP configuration | On Linux with Docker, run `python3 services/sip/tests/validate_edge.py` from root; see [gate scope and prerequisites](services/sip/README.md) |
| Native modules/plugins | Regeneration checks, platform builds, and physical-device acceptance from [mobile calling](mobile/src/features/calling/README.md) |
| Documentation only | Validate local links, code paths, command descriptions, and consistency; app builds are unnecessary |

Do not declare an incident resolved with failed or missing required gates. Record the failing command and distinguish a regression from an existing failure or unavailable dependency. Repair or revert only the responsible task-owned change; never discard unrelated user work or perform a blanket reset.

Before authorized promotion, retain the prior artifact/configuration and a concrete rollback procedure. Coordinate SIP/API credential and routing contract rollout order using the owning README. Verify post-promotion health and the affected behavior; if the change causes a regression, restore the reviewed prior artifact through the deployment workflow. A Vercel deploy does not deploy SIP services or native mobile binaries.

## 7. Incident closure record

```text
Incident / timestamp / affected tenant scope (redacted):
Client platform and build / deployed API and service SHAs:
Selected edge and evidence at incident time:
Expected behavior / observed behavior / first divergent event:
Correlated route, dialog, channel, carrier-leg and turn IDs (redacted):
Confirmed cause and supporting evidence:
Changed files and affected contracts:
Regression checks and exact results:
Device, carrier, capacity or access limitations:
Promotion status / post-change evidence / rollback artifact:
Remaining acceptance gates and owner:
Status: investigating | fixed locally | awaiting acceptance | resolved
```

Use `resolved` only when the required checks and incident-specific acceptance criteria have passed. Documentation creation or a local fix alone does not establish production recovery.
