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
