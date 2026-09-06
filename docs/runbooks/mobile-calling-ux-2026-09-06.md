# Mobile calling experience changes

Status: local implementation, not deployed or included in a new native build.

## Number entry

`mobile/src/features/calling/state/dialNumber.ts` uses libphonenumber-js.
An explicit `+` or `00` international prefix wins. Otherwise a contact's country
metadata or the user's manual country choice interprets national numbers. The
default is the device locale region, then the profile's international mobile
number. No Saudi Arabia fallback is applied. Device locale is a numbering
preference, not a claim that we know the device's physical location.

International numbers selected from Contacts retain their prefix and name.
External contacts open the dialer for review. Internal contacts retain their
existing internal-call route. Short extension numbers are not valid external
destinations. Country rates are matched by parsed destination, including the
shared +1 numbering plan; unknown prices are not invented.

The dial pad and active-call screens remain clients of the existing contexts. No
SIP transport, token, background wakeup or media negotiation logic changed.
The pre-answer timer stays hidden. A synchronous dial guard prevents duplicate
call-button taps while the start request is pending.

## Unified dialer

Phone/Extension tabs have been removed. `resolveCallDestination` matches a
2-5 digit number against the current company directory. An exact, unique match
selects internal calling; the employee's own extension and unknown extensions
are disabled. Explicit international prefixes never select an internal route.
Full valid phone numbers select external calling, with existing caller-ID,
balance and server authorization rules retained. Detection is not authorization:
the route API still resolves the tenant and destination at call time.

`useCallingDirectory` loads independently of number entry. External calls do
not wait for it. Pending or failed directory requests show an inline status for
short numbers, with retry on failure. Changing user or organization immediately
hides the previous directory, and late responses are ignored. A malformed
directory fails closed rather than enabling guessed extensions.

Dial Pad replaces Home and opens directly to the keypad. Call history lives only
on Recents, and conference is an icon in the Dial Pad header.
Its participant rows accept either number type without selectors. Numbers are
normalized before duplicate detection; internal participants use directory IDs
in the existing API contract. The API remains responsible for permissions and
company boundaries. Regular-number conferences are available to individual
accounts with outbound calling enabled; company accounts can also invite
extensions. External participants require an owned caller ID and the existing
wallet checks. These changes do not add SIP or conference-engine features.

## Receptionist speech

The Vocivo-hosted speech path now preserves complete sentences instead of
splitting an opening sentence at a comma. Streaming prewarm uses the same
sentence boundary. Background speech music defaults to disabled; a configured
`RECEPTIONIST_SPEECH_BED` still takes precedence. No voice provider or customer
voice selection was changed. The receptionist service must be deployed
separately from Vercel. Listen to real calls before judging naturalness or
first-response latency; mock speech tests cannot establish either.

## Recording: requested, not implemented

Product requirement: recordings belong to the company workspace, with an
audible notice to participants. Do not ship a fake recording indicator or a
microphone-only recorder.

Current constraints:

- Internal SIP calls traverse Kamailio and RTPEngine, not FreeSWITCH.
- FreeSWITCH's existing recording path is voicemail, not active two-way calls.
- There is no active-call recording control API, private recording library,
  recording daemon or participant-notice workflow.
- Existing `callRecording`, organization `recordingEnabled` and employee
  `permissions.recording` settings are permissions, not proof of capability.

Required implementation gates:

1. Establish a trusted active-dialog index from authenticated SIP events.
   Resolve the tenant and participant server-side; never accept the client's
   organization ID or call ID as authorization on its own.
2. Add a media-side controller for both internal and external call paths.
   Pin and validate supported media-engine versions. Prove announcement and
   two-way capture without silently rerouting every existing call.
3. Use an idempotent state machine: requested, announcing, recording, stopping,
   ready or failed. Start capture only after notice playback is confirmed for
   every participant. Late joiners also receive notice. Fail closed when notice
   or media setup fails. A UI tap never means recording has started.
4. Enable through superadmin entitlement, company configuration and employee
   permission checks. Include participant identity, tenant and state in audit
   events, but never audio or credentials in application logs.
5. Upload to private encrypted storage and tenant-scoped metadata. Downloads
   require fresh authorization and short-lived access. Enforce retention,
   deletion, upload retry, size/duration limits and disk backpressure.
6. Add confirmed Record/Stop controls and a company recording library. Restrict
   playback and deletion to authorized company users. No recording on personal
   accounts until a separate policy exists.
7. Test cross-tenant denial, duplicate taps, answer/hangup races, notice failure,
   transfers, conference joins, interrupted uploads, retention and device
   migration. Validate audible notices and both audio tracks on physical iOS,
   Android and web calls before enabling production capability.

Recording notices alone are not a universal legal compliance guarantee.
The company must configure its approved consent and retention policy before
activation. No recording is enabled by this change set.

## Validation

Local results on 2026-09-06: mobile typecheck passed; 124 unit tests and 34
integration tests passed after unified dialing; receptionist suite passed 53 tests. The iOS simulator
rendered the real screens through the isolated fixture: contact-to-extension
navigation, mute, hold/resume state and ending the fixture call were checked.
No new native binary was built. Android device rendering, production audio,
background calling and receptionist listening tests have not been performed
for this change set. iOS and Android Hermes JavaScript exports compile, but
these are not signed native builds. After the Mac was unlocked, the unified
dialer was checked in the iPhone simulator with the real BottomTabs component:
all five menu entries remained visible, and entering 2001 matched the fixture
colleague without a mode selector. Conference visual and physical-device
checks remain pending. Tests still report a pre-existing React Native
SafeAreaView deprecation in RatePicker; it is not a test failure.

Run `npm run typecheck` and `npm test` in `mobile/`. The isolated native UI
harness is documented in `mobile/tests/ui/README.md`. Run `python3 -m unittest
discover -s tests -v` in `services/receptionist/` in an environment permitting
loopback sockets. These checks do not replace physical-device audio testing.

Final Dial Pad validation: 124 mobile unit tests, 42 mounted integration tests,
and 340 frontend/API tests passed. Mobile and API type checks, frontend build,
and iOS/Android JavaScript exports passed. The final Dial Pad layout was
inspected in the iPhone simulator with all five bottom tabs visible. Regular
number and mixed conference requests were tested with mocks; live conference
audio and physical-device calling remain release checks.
