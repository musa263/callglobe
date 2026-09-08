# Telnyx integration audit — 7 September 2026

## Remediation and second sweep

The original nine findings below are now fixed in the working tree. No production
deployment or paid carrier action was performed. The original audit is preserved
below as historical evidence; its line numbers describe the pre-fix code.

| Finding | Resolution | Regression evidence |
| --- | --- | --- |
| T1 | Webhooks return retryable failures for incomplete pair/fork termination. Losing-fork cleanup runs after winner bridging and cannot tear down the winner on failure. | `calling/routes/voice-webhook.test.ts` checks failed cleanup, redelivery, and bridge-before-cleanup order. |
| T2 | Conference host cleanup uses tracked termination; room and queue records are removed only after required hangups succeed. | Conference webhook failure/retry regression; existing participant termination tests. |
| T3 | Browser cancellation uses an account-bound, per-tab persisted outbox; retries survive reload and honor Retry-After. | Outbox unit tests and `scripts/test-telnyx-ui.mjs` offline/reload scenario. |
| T4 | JWT payload is decoded correctly; invalid/expired tokens fail safely and short grants are not extended by mobile scheduling. | Token expiry regression covers 24-hour, short, malformed and expired tokens. |
| T5 | Browser token startup retries with bounded backoff and on network restoration; timers/listeners tear down. | Real-hook browser regression starts with a 503, then becomes ready without remounting. |
| T6 | One-second route polling with a 60-second deadline covers carrier ringing without the 100-request burst. | Browser request-count check and ringing beyond the old 18-second window. |
| T7 | Provider event time, terminal precedence, and recipient outcomes determine the SMS projection. | Reordered failure/sent, confirmed delivery, and tenant-mismatch tests. |
| T8 | A transactional encrypted record and recent-history entry are maintained per message. Existing history migrates incrementally with checkpoint protection. | Twenty repeated events occupy one record and one history slot; distinct tenants remain separate. |
| T9 | SDK source declaration is repaired; both source and compiled patch variants use consistent secure storage options. | Source/runtime parsers and isolated reverse/check/reapply of the patch. |

Additional fixes found in the sweep:

- Delayed `call.initiated` after answer/bridge no longer hangs up the selected
  outbound or inbound agent leg. Canceled routes and losing legs still terminate.
- A bridge-triggered `call.dequeued` no longer ends the winning agent or deletes
  the queue record needed for subsequent cleanup. Telnyx explicitly documents
  that bridging dequeues the call. [Telnyx queue behavior](https://developers.telnyx.com/docs/voice/programmable-voice/queueing-calls).
- Connected inbound-agent cleanup and late/rejected/voicemail/conference cleanup
  no longer silently acknowledge carrier hangup failures.
- Browser socket loss explicitly closes peer connections/stops tracks, and late
  ACTIVE events cannot resurrect the ended call.
- Telnyx balance requests coalesce concurrent misses and share a 2.5-second
  deadline. Positive-credit policy is preserved; failed reads do not become credit.
- Mobile and patched SDK session writes use
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, supporting locked-device reads after the
  first unlock. New unit/integration tests check that contract. Existing items
  migrate on an unlocked launch that writes the session.

Validation commands:

```sh
bash verify.sh
cd frontend
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-telnyx-ui.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-web-startup.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-sip-ui.mjs
```

The three browser suites passed. SDK source/runtime parsing and isolated patch
reapplication passed. Final `bash verify.sh` passed API typecheck, 416 backend/web
tests, the production web build, mobile typecheck, 135 mobile unit tests, and
47 mobile integration tests across nine suites: **598 tests, zero failures**.
The web build retains its existing large-vendor-chunk advisory. Changed-file
whitespace checks passed. The verification log is `/tmp/vocivo-telnyx-verify.log`.
Tests use fixtures; they do not establish live carrier delivery, RTP quality, or
native build acceptance. Webhook redelivery has a finite provider retry budget;
browser outboxes need the tab and the original account to resume. Exhausted
carrier retries still require operator reconciliation. Physical locked/killed
device tests, carrier settings/webhook-delivery inspection, and live database
migration latency remain acceptance gates. Overlapping debugging-task changes
were preserved, including its SMS send-operation/correlation work; they are not
independently owned by this Telnyx patch.

## Original audit

Scope: Telnyx managed voice, client recovery, carrier cancellation, SMS events,
and the carrier boundary of the SIP trunk. Read-only implementation audit at
HEAD `50c5618` plus the existing working tree. No application code changed,
deployment performed, paid call placed, or message sent.

Installed packages: web `@telnyx/webrtc` 2.27.10; mobile
`@telnyx/react-voice-commons-sdk` 1.1.0 with repository patches. Existing SIP
working-tree edits were preserved. The local environment file does not establish
the production voice edge. Findings below are code defects or explicitly marked
risks, not proof that each one caused a production incident.

## Confirmed code findings

### T1 — High: webhook acknowledges incomplete carrier termination

Evidence: `frontend/api/_lib/features/calling/routes/voice-webhook.ts:735`,
`:747`, `:771`, `:793`; `outbound-cancel.ts:200` in the same feature.

`terminateOutboundPair()` deliberately returns `{ complete: false, pair }` when
carrier hangups fail. These webhook callers discard that result and return HTTP
200. Retaining a retryable pair is insufficient: no recurring termination worker
was found among the call sites. If the peer never sends another event and the
client does not retry, a remaining leg can keep ringing or remain connected and
incur carrier usage. The cancel HTTP route correctly returns 503 for this case;
the webhook does not honor the same contract.

Fix: retain incomplete work and schedule durable retries, or return a retryable
webhook failure with idempotent handling. Test carrier 503 through the real
webhook handler, followed by recovery with no additional client activity.

### T2 — High: conference hangup removes tracking after failed hangups

Evidence: `frontend/api/_lib/features/calling/routes/voice-webhook.ts:772-779`.

When the credential-connection leg of a conference host ends, individual hangup
failures are caught and logged, then both pair records are cleared. Unlike T1,
this also destroys the tracking needed to retry the remaining participant legs.
An HTTP failure from Telnyx can leave participants on untracked carrier calls.

Fix: use the existing tracked conference termination helper and clear records
only after confirmed completion. Test one participant hangup failing while the
other succeeds; preserve and retry only the unfinished leg.

### T3 — High: web cancellation gives up before remote completion

Evidence: `frontend/src/features/calling/hooks/useTelnyxVoice.js:11-15`,
`:663-687`; server contract `frontend/api/_lib/features/calling/routes/voice-cancel.ts:40-43`.

`cancelWebRoute()` makes two immediate requests and then logs the failure and
resolves. The UI clears the route reference even though cancellation can remain
pending. Disconnect/socket-close paths make only one best-effort request.
There is no retained browser retry queue or reconnect drain in this hook.
Combined with T1, a temporary outage can outlive every automatic cleanup attempt.

Local probe using the actual extracted helper: two mocked 503 responses produced
exactly two requests and a resolved promise; no pending work survived.

Fix: persist session-bound cancellation work until `{ canceled: true }`, honor
retry timing, and drain on recovery. Test offline hangup followed by reconnection.

### T4 — Medium: token lifetime parser always falls back to one hour

Evidence: `frontend/api/_lib/features/calling/routes/telnyx-token.ts:30`.

The JWT is split on `'../../../../telnyx'` instead of `'.'`. Normal tokens never
reach expiry decoding. Web and mobile therefore renew unnecessarily and mobile
stored-token bootstrap rejects otherwise valid cached tokens after about an hour.
For a credential expiring earlier, the opposite error is possible: the client
can treat an expired token as fresh. Telnyx documents validity until 24 hours or
parent-credential expiry, whichever comes first.

Local probe using the extracted function: a synthetic JWT with 86,400 seconds
remaining returned 3,600 seconds.

Fix: decode the correct JWT payload for scheduling, validate expiry values, and
test long, short, expired, and malformed lifetimes. This scheduling decode is
not a substitute for authenticating tokens.

Source: [Telnyx JWT authentication](https://developers.telnyx.com/docs/voice/webrtc/auth/jwt).

### T5 — High: web startup token failure has no automatic recovery

Evidence: `frontend/src/features/calling/hooks/useTelnyxVoice.js:197-211`,
`:443-450`.

If the initial `/api/telnyx/token` POST fails, the catch sets “Unable to connect”
but does not schedule a retry. No SDK client exists to emit socket-close recovery
events, and the token-refresh timer is only installed after a successful token
response. With unchanged login/enabled props, connectivity returning does not
restart this effect. A transient startup API failure leaves calling unavailable
until a remount or another dependency change.

Fix: bounded backoff and online recovery for token acquisition, with teardown.
Test one rejected token request followed by success without remounting.

### T6 — Medium: route polling floods requests and stops before ring timeout

Evidence: `frontend/src/features/calling/hooks/useTelnyxVoice.js:452-500`;
`frontend/api/_lib/features/calling/voice-control.ts:93` (`timeout_secs`).

The web hook performs up to 100 sequential status requests with 80 ms sleeps for
40 iterations and 250 ms thereafter. The sleep budget is only 18.2 seconds plus
request latency, while destination dialing defaults to a 45-second timeout.
On a fast backend, an unanswered but still-valid call loses local ringback and
shows a slow-setup error well before the destination timeout. Each request also
authenticates and reads the stored route, amplifying load across ringing calls.

Fix: use an elapsed-time deadline aligned with carrier setup, a much lower poll
frequency, and appropriate backoff. Fake-clock tests should preserve ringing
through the agreed setup window and enforce a request-count budget.

### T7 — Medium: delayed SMS events can replace terminal results

Evidence: `frontend/api/_lib/features/messaging/routes/messaging-webhook.ts:31-46`;
`frontend/api/_lib/features/messaging/message-store.ts:94-97`.

Webhook events receive `updatedAt = now` rather than provider event ordering.
The reader sorts by this arrival timestamp and lets the last arriving event win.
A failed finalized event followed by a delayed successful `message.sent` event
therefore becomes “sent” and loses its error. The mapping also ignores recipient
delivery status, reducing non-error outbound events to “sent.”

Fix: preserve event ID, provider occurrence time, and terminal status precedence;
map documented recipient outcomes. Test finalized failure followed by delayed
sent, duplicate finalized events, and delivery-status transitions.

Source: [Telnyx SMS webhook ordering and event types](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks).

### T8 — Medium: duplicate SMS webhooks consume new history slots

Evidence: `frontend/api/_lib/features/messaging/message-store.ts:46-48`, `:83-97`;
`frontend/api/_lib/features/messaging/routes/messaging-webhook.ts:40`.

Storage keys hash message ID plus receipt-time `updatedAt`. The same webhook
retried at a later time creates a new object. The reader deduplicates only after
loading a maximum of 1,000 objects, so retries and status updates consume the
finite history window and increase storage/read work. This contradicts the
feature README's idempotent-event claim.

Fix: stable provider-event idempotency and a bounded per-message projection.
Test repeated delivery of one event creates no additional stored events and
cannot crowd older distinct messages out of the query window.

### T9 — Medium: repository Telnyx patch produces invalid TypeScript source

Evidence: `mobile/patches/@telnyx+react-voice-commons-sdk+1.1.0.patch:2732-2734`.

An inserted `const iceServers` declaration splits `const useTrickleIce =` from
its expression. The installed patched SDK source contains the same defect at
`src/telnyx-voip-client.ts:406`. The TypeScript parser reports “Expression expected.”

The package currently resolves its `lib/index.js`, and the inspected compiled
version of this block is valid. Therefore this is a source rebuild/maintenance
defect, not evidence that the current published mobile binary fails to launch.

Fix: move the declaration outside the initializer and verify both source and
compiled patch variants after a clean dependency installation.

## Additional risks requiring runtime evidence

- **Locked iPhone incoming calls:** mobile session persistence explicitly uses
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`runtime/voipClient.ts:31`), while the patched
  SDK reads that session to reconnect from push. Verify access and answer behavior
  on a physically locked device after process termination. Do not claim a passing
  foreground test covers this path.
- **Socket loss versus surviving media:** the web SDK is configured with
  `keepConnectionAliveOnSocketClose: true` (`useTelnyxVoice.js:220`) while its
  socket-close handler clears UI/call references and requests remote cancellation
  (`:261-330`). No explicit local media teardown occurs in that handler. Exercise
  a signaling-only outage with RTP still flowing and measure microphone/peer
  connection disposal, late call events, and recovery before choosing a fix.
- **Balance API adds setup latency:** `/api/voice/route` awaits carrier balance.
  `shared/telnyx.ts:74-78` caches for 15 seconds per process without coalescing
  concurrent misses; GET permits two seven-second attempts by default. During
  balance API trouble this can add roughly 14 seconds plus backoff even on the
  SIP PSTN path that eventually tolerates the API failure. Measure production
  latency and concurrency; preserve explicit no-credit policy when improving it.

## Verification and remaining acceptance

Executed eight existing test files with Node/tsx: shared Telnyx transport and
webhook authentication; calling cancellation, bridging, parked destination dial,
voice routing and provider selection; messaging store. **57 tests passed, zero
failed.** These exercise helpers and fixtures, not all webhook or React effects.
Two extracted-function probes demonstrated T3 and T4. A TypeScript parse probe
demonstrated T9. No full build or native acceptance was claimed; this audit adds
documentation only.

Reviewed SIP trunk profile/gateway ownership and number-connection selection;
no additional carrier-trunk defect was confirmed from static configuration.
Live Telnyx account balance, webhook delivery failures/timing, connection and
outbound-profile settings, DID assignments, IP ACLs, active production edge,
deployed build identity, and RTP quality remain unverified. A complete incident
diagnosis needs a timestamp and correlated call/leg identifiers plus authorized
read-only production diagnostics. Physical iOS/Android foreground, background,
locked/killed-state, Wi-Fi/cellular, Bluetooth and two-way-audio tests remain gates.

Recommended order: T1/T2/T3 cleanup reliability; T5 startup recovery and T4 token
lifetime; T6 polling; T7/T8 SMS; T9 SDK patch source consistency. No finding should
be read as confirmation of a Telnyx service outage or as an exhaustive inventory
of production failures.
