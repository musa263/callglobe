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
