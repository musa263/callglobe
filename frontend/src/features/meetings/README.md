# Web Calls Workspace

App's Calls workspace has Recents, Voicemail, Schedule and Video tabs. The dial
pad header links into these views without adding bottom-navigation items.
`MeetingsView` owns create/edit/remove and opens a scheduled phone number in the
dial pad without automatic dialing. A new video schedule creates a real room
using the existing authorized video API; an existing room code is also accepted.
Provider failure is reported and never replaced with a simulated meeting.

`calendar.js` uses the pinned `ics` package for UTC events, escaped text, stable
UID/version and a ten-minute calendar reminder. No bearer token is exported.
Video links open the authenticated lobby, not the camera. Meetings are scoped to
the signed-in user; room attendance remains restricted to the same organization.
There is no guest/email invitation service. Downloaded calendar files are not
automatically resynchronized after changes or deletion.

`communications.css` owns tabs, lists and forms. Video and voicemail components
are owned by `features/video` and `features/calling/voicemail` respectively.
Run `bash verify.sh` and `frontend/scripts/test-communications-ui.mjs` with
`PLAYWRIGHT_MODULE` and `VOCIVO_TEST_ORIGIN` set to the local Vite server.
The browser script mounts real App/components with isolated API/media fixtures.
Physical media and live provider authorization require separate acceptance.
