# Vocivo pending bug and risk audit — 2026-09-07

Reviewed revision: `50c5618`. This is an audit; application behavior was not changed.

Scope: web/API and mobile quality gates; auth/session, tenant access, billing, messaging, enrollment and video route review; SIP/CDR/TURN configuration; native incoming-call code; receptionist and TTS paths; browser call regressions; current npm production dependency audits. This is a broad repository review, not proof that every screen, native binary or production call path is defect-free.

Severity: **Critical/P0** means immediate broad compromise or outage; **High/P1** means material financial exposure or a core call flow can fail; **Medium/P2** means a conditional failure, incorrect reporting or recoverability problem; **Low/P3** means performance/maintenance impact. No critical defect was confirmed. Eight pending defects were identified: two high and six medium. Separate release risks follow.

## Confirmed pending defects

### B01 — High: customer calling credit is checked but not consumed

Evidence: [voice-route.ts](../../frontend/api/_lib/features/calling/routes/voice-route.ts#L100), [wallet-store.ts](../../frontend/api/_lib/features/billing/wallet-store.ts#L421), [voice-sip-cdr.ts](../../frontend/api/_lib/features/sip/routes/voice-sip-cdr.ts#L43).

The outbound gate only requires a positive available balance. Repository-wide call-site search finds `recordWalletAdjustment` called only by the admin adjustment endpoint. No call reservation, usage settlement or duration-driven debit is connected to the SIP CDR or managed call webhook paths; `reserved_minor` is initialized and read but never updated. Positive credit therefore does not impose a spend limit through the implemented application paths, while PSTN calls can incur carrier cost. An external billing process outside this repository was not inspected.

Fix: reserve a priced allowance atomically before granting an outbound call, enforce a funded duration/concurrency budget, settle usage idempotently from authenticated completion records, and release reservations after cancellation/failure. Test concurrent calls, duplicates, missing CDRs and exhaustion. Keep internal calls free.

### B02 — High: AI command acknowledgment has no timeout

Evidence: [esl.py](../../services/receptionist/app/esl.py#L134), especially the unbounded reply queue wait at line 143. `execute(timeout=...)` starts its completion deadline only after `_send` returns.

Reproduced with the real EslConnection and an in-memory stream that never acknowledges: `execute(..., timeout=0.01)` remained pending after 0.08 seconds. The shielded exchange also retains the command lock after caller cancellation until acknowledgment or closure. A stalled FreeSWITCH command can leave a caller waiting and block subsequent commands.

Fix: bound acknowledgment and execution separately, mark a timed-out connection unusable, and close/cancel pending exchanges without misattributing a late reply. Add no-ack, late-ack, cancellation and hangup regressions.

### B03 — Medium: complete speech-synthesis failure is treated as a successful turn

Evidence: [call.py](../../services/receptionist/app/call.py#L224).

Each failed render becomes `None`; an empty playback batch is skipped. Reproduced by making every synthesis request fail: `_speak` returned normally with zero playback commands. Callers can hear silence while the conversation continues or a subsequent action proceeds.

Fix: distinguish partial speech from no audible output, use a verified local fallback prompt, and return an explicit outcome so transfer/message decisions do not assume the explanation was heard. Test total and partial synthesis failure.

### B04 — Medium: internal call records can be lost during delivery failure

Evidence: [kamailio.cfg](../../services/sip/kamailio/kamailio.cfg#L605), [edge-api.conf](../../services/sip/nginx/edge-api.conf#L25).

The timer fetches records out of an in-memory queue before posting through the local proxy. On transport failure it only logs; there is no requeue or durable acknowledgment. It also does not explicitly handle non-success HTTP statuses. Restart and API/proxy outages can create missing Recents/report records. This is separate from FreeSWITCH's own CDR retry behavior.

Fix: durable idempotent outbox, explicit success-status checks, bounded backoff and failed-delivery monitoring. Test outage/restart and duplicate delivery.

### B05 — Medium: retrying an SMS after a storage failure can send it twice

Evidence: [messages.ts](../../frontend/api/_lib/features/messaging/routes/messages.ts#L57).

The carrier send happens before local event storage. If storage fails after the carrier accepts, the handler returns an error; retrying creates another send because the route has no client operation key or durable send state. The shared carrier wrapper correctly avoids automatic POST retries, but that does not protect a second user request.

Fix: persist a client operation ID and send state, reconcile ambiguous acceptance, and return the same result for repeated submissions. Test carrier acceptance followed by a database error. No live SMS was sent during this audit.

### B06 — Medium: owner sessions issued in the password-change second survive revocation

Evidence: [auth.ts](../../frontend/api/_lib/features/auth/auth.ts#L162), [auth.ts](../../frontend/api/_lib/features/auth/auth.ts#L173).

The revocation timestamp is rounded down to seconds and the check rejects only `iat < cutoff`. An old token issued earlier in the same second has `iat == cutoff` and remains accepted even after the cache refreshes. The separate 15-second cache also delays propagation to other instances. This is a boundary defect in the intended revoke-existing-sessions behavior, not a passwordless-login finding.

Fix: use a monotonic credential/session generation and mint the replacement against that generation. Test same-second issuance and multiple instances; changing `<` to `<=` alone would also reject the current replacement token.

### B07 — Medium: wallet 30-day totals undercount busy accounts

Evidence: [wallet-store.ts](../../frontend/api/_lib/features/billing/wallet-store.ts#L446), [admin-wallets.ts](../../frontend/api/_lib/features/billing/routes/admin-wallets.ts#L62).

Only the latest 150 ledger entries across the platform are loaded, then filtered and summed as 30-day credits/debits. With more than 150 entries in that period, legitimate entries are omitted from the advertised total.

Fix: calculate date-bounded totals in SQL independently of the paginated activity list. Test more than 150 entries and multiple tenants.

### B08 — Medium: web incoming-call notifications can remain after the call ends

Evidence: [web-push-dispatcher.ts](../../frontend/api/_lib/features/push/web-push-dispatcher.ts#L29), [sw.js](../../frontend/src/sw.js#L9).

The payload has a delivery TTL but no explicit call deadline/cancellation lifecycle. The service worker shows a persistent `requireInteraction` notification and does not close it on call termination. A notification already displayed can continue inviting the user to answer a completed call. TTL limits delivery, not the lifetime of an already displayed notification.

Fix: carry call IDs and deadlines, reconcile cancel/answer events, and close stale notifications. Test cancellation before delivery, after display, and while the page is closed.

## Additional risks and incomplete validation

| Level | Risk | Evidence and next step |
|---|---|---|
| High, dependency triage | Mobile audit reports 9 high and 13 moderate affected package entries | Current `npm audit --omit=dev`: high entries include Expo/Metro, image-size and postcss. These include build-tool chains, not 9 proven exploitable mobile-runtime bugs. Determine advisory reachability and update with native compatibility testing. Frontend reports 4 moderate, no high/critical. |
| High, release acceptance | Native and real media behavior remains unverified here | JS mocks and source review cannot prove locked/killed iOS/Android delivery, Bluetooth, two-way RTP, handover, or multi-device answer/cancel. Test physical devices against the intended release revisions. |
| Medium, network compatibility | TURN TLS is disabled | `services/sip/docker-compose.yml:95` uses `--no-tls` and `--no-dtls` on port 3478. Provision and verify a TURNS route for restrictive networks. The old narrow relay-port range has already been expanded; do not report it as still present. |
| Low, performance | Coarse vendor bundle | `frontend/vite.config.js:52` places all dependencies into one vendor chunk; current build reports 907.37 kB minified / 243.39 kB gzip. Measure startup and split provider dependencies. This is not a measured production latency incident. |

## Validation performed

- `bash verify.sh`: passed — 376 frontend/API tests; API typecheck and web build; mobile typecheck, 134 unit tests and 44 integration tests across 8 suites.
- Receptionist: 60 tests passed. Initial sandbox socket-bind failures were resolved by rerunning with local networking enabled.
- Browser startup suite: 8 scenarios passed; SIP UI suite: 5 scenarios passed. Both use intercepted API/SIP fixtures and placed no real calls.
- Two additional local fault probes reproduced B02 and B03 using the real owning functions.
- Frontend and mobile npm audits completed against the installed lockfiles.
- TTS suite could not import `soundfile` in the available Python environment. This is a test-environment blocker, not a demonstrated TTS runtime failure.
- No live customer calls/SMS, authenticated production walkthrough, native build/device test, load test or deployment change was performed.

The previous audit's SIP identity/dialog routing, mobile pending-answer, Android push-expiry and AI turn-limit findings were not carried forward as open: current code contains repairs. Their physical-device/media acceptance still needs separate evidence.

Recommended order: B01 financial controls; B02/B03 AI failure handling; B04/B05 delivery reliability; B06 revocation; B07/B08 reporting and notifications. Resolve dependency reachability and native/media acceptance before treating a release as fully verified.
