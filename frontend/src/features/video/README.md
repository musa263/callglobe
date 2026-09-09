# Browser Video

`main.jsx` is loaded by `video.html`; `VideoRoom.jsx` owns the reusable SDK/UI.
`video.css` contains meeting-specific layout. Room/token authorization is in the
backend video feature; this screen must not accept an arbitrary room as permission.
Build checks validate imports; camera/microphone and room membership need browser QA.

The shared `BrandHeader` occupies a separate top row from the media surface.
`scripts/test-web-branding.mjs` checks its layout with a no-media SDK fixture;
it does not validate video signaling or real camera access.

`VideoLobby` adds authenticated start/join to the web Calls workspace. Join tokens
remain in component memory, not calendar files or web URLs. `VideoRoom` uses
the unsubscribe function returned by the installed SDK's `room.on`, not a
nonexistent `.off` method. It disposes late initialization/media results on leave,
handles participant streams separately, and stops tracks on failures. The web
lobby refreshes room tokens through the authorized API before one-hour expiry.
The mobile WebView retains its existing token input and needs separate long-call
token renewal acceptance. SDK reference: https://developers.telnyx.com/docs/video/javascript-sdk/room-events
