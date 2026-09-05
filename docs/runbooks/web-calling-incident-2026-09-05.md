# Web calling and AI audio incident

Investigated against commit 5647217. Validation below was performed locally
before release; it does not certify the production media path.

## Confirmed defects corrected

- `frontend/src/App.jsx`: voice startup depended on `session.token`, while
  `storeSession()` deliberately strips that bearer. Reloading therefore never
  fetched voice configuration or registered either phone provider. Startup now
  uses the server-verified profile identity and cookie-authenticated API calls.
- `frontend/src/shared/api.js`: legacy credential migration discarded the whole
  account entry. It now removes the bearer but retains metadata so the existing
  httpOnly cookie can be verified. An invalid cookie still prevents registration.
- `frontend/src/features/calling/hooks/useSipVoice.js`: SIP incoming calls had no ringtone path.
  The incoming tone now stops on answer, termination, replacement, and unmount.
  The previously inert Resume audio action now retries browser media playback.
- `frontend/src/features/calling/engine/sipSession.js`: the audio element was captured before it
  necessarily existed, and tracks arriving after Established were ignored.
  Playback now resolves the element at answer, handles subsequent tracks, and
  releases the owned media binding and listeners during teardown.

## Evidence and limits

- Frontend/backend automated tests: 289 passed, including media binding and
  credential migration. API type checking and production build passed.
- `frontend/scripts/test-web-startup.mjs` mounts the complete App, not only a
  hook. Passed reload registration, incoming ringtone/CANCEL, answering and
  playback retry, and invalid-cookie rejection. SIP transport, API responses,
  and Audio playback are fixtures: these are not real carrier audio tests.
- Browser screenshot inspected at `/tmp/vocivo-full-app-qa.png`.
- Existing SIP lifecycle harness initially hit its navigation load timeout on
  this resource-constrained Mac; after waiting for DOM readiness explicitly,
  all four scenarios passed: remote CANCEL cleanup, Answer/CANCEL collision,
  cancellation during route reservation, and exactly one active-call BYE.
- Production receptionist logs show the two calls at 19:47 and 19:48 UTC on
  September 4 reached the receptionist API and issued WAV playback commands.
  No caller transcription was recorded for those calls. Playback commands do
  not prove successful RTP delivery or audibility at the caller.
- Live Kokoro health: ready=true, prerenderQueue=0, 36 cached prompts. This does
  not prove the cached files or the carrier media path are audible.
- SIP server files were last shipped before the web release. This release did
  not deploy the SIP containers or production receptionist source.
- Further live checks were blocked when GitHub CLI authentication became
  invalid. Direct local SSH was also refused (publickey). Restore authorized
  access before obtaining media/firewall and per-call RTP evidence.

## Required before closing

Deploy the validated web correction, then verify real authenticated reloads,
incoming ringing, Answer/Cancel races, voice previews, and a PSTN call into the
AI receptionist. Correlate caller and switch media statistics. Do not close
the live AI audio incident based on unit tests or service health alone.
