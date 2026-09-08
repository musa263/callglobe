# Web Calling

`hooks/useVoice.js` selects the configured provider behind one UI contract.
`useSipVoice` manages registration, sessions, ringback, route reservation and
local teardown. `useTelnyxVoice` implements the managed SDK path separately.
`components/Dialer`, `IncomingCall` and `ActiveCall` render intent/state without
owning a second signaling engine. `history/` owns recent-call persistence/display.

For SIP, `engine/sipSession` creates the SIP.js agent and attaches remote media;
`sipRegistrationKeeper` serializes reconnect/register retries. `sipCallLifecycle`
chooses CANCEL/BYE/reject; `sipCallHealth` monitors transport/media with a bounded
recovery grace. `sipDial` handles route timing and `callIdentity` formats identity.

Run frontend `npm test`, `npm run build`, `scripts/test-sip-ui.mjs` and
`scripts/test-web-startup.mjs` (see root CONTRIBUTING). Fixtures test state/UI,
not the provider's two-way audio. Check both browser sizes and unmount cleanup.

The Telnyx hook retries startup token failures with bounded backoff and an online
listener. Route polling runs once per second through a 60-second setup window.
`engine/webRouteCancellation.ts` persists pending route IDs in per-tab session
storage, scoped to the authenticated account identity; only `canceled: true`
removes work. It retries every five seconds and on focus/online, honoring the
server's retry delay. Closing the tab or an exhausted provider webhook retry
budget still requires server/operator reconciliation; browser timers are not a
durable server worker. Storage errors are surfaced instead of reported as success.

Socket-close cleanup explicitly stops tracks and closes peer connections before
discarding calls. Ended-call identities reject late active notifications for the
current SDK client. `scripts/test-telnyx-ui.mjs` mounts the real hook with a carrier
fixture and checks startup recovery, request volume, the ringing window, reload
cancellation, media disposal, and listener teardown. Run with `PLAYWRIGHT_MODULE`
and the same Vite origin as the existing browser suites.

`useVoice` accepts an optional configuration owner so App can overlap the
cookie-authenticated config GET with profile verification. Results from an old
owner are discarded; final HTTP 401/403 is surfaced without a config retry loop.
SIP startup still waits for the verified profile, and Ready still requires the
registrar acknowledgement. Bootstrap display-name enrichment updates the name
used on the next real identity/credential restart, not the running registration.
`scripts/test-web-startup.mjs` checks the overlap, negative auth gate and absence
of an extra SIP setup when delayed profile details arrive.

## Connection recovery

An explicit foreground refresh sends REGISTER even if SIP.js still reports a
live transport and registration. Local flags can survive a network migration.
Idle mobile network changes debounce for one second and request fresh SIP/ICE
configuration; foreground bootstrap rechecks SecureStore expiry after suspended
timers. HTTPS failures retry with bounded backoff. A forced renewal queued behind
a cached bootstrap is retained and shared by concurrent callers. Final 401/403
rejections trigger bounded credential renewal; ordinary Digest challenges remain
inside SIP.js. Active/incoming calls keep their stack during network recovery.

The web client debounces online events and renews idle configuration, and checks
the renewal deadline when a hidden tab returns. Short credential lifetimes renew
at 80% without the previous five-minute floor. The stored SIP password and TURN
configuration have different lifetimes; use the API's configuration expiry.

Run the keeper unit tests, mobile SipRecovery/SipBootstrap integration suites,
`bash verify.sh`, and the browser SIP harness. These prove controlled recovery,
not physical Wi-Fi/5G handoff, killed-state operation, or two-way carrier audio.

The dialer displays imported company carrier numbers and prevents external calls
through a pending carrier line. Internal calling still uses the extension route.
The server independently validates activation and ownership for every call.

The web dialer has one number input. `engine/callDestination.ts` matches short
numbers against the current company directory, rejects self/unknown/ambiguous
extensions, and treats explicit international prefixes as public numbers.
`hooks/useCallingDirectory.ts` hides the prior company's results immediately
when scope changes. Directory failure is retryable; it never sends a short
extension to a carrier. Country selection defaults from the user's/caller's
number or browser region and remains manually adjustable. The full-App browser
harness covers automatic internal routing without a mode switch.
