# Browser Video

`main.jsx` is loaded by `video.html` and coordinates the video-room SDK/UI.
`video.css` contains meeting-specific layout. Room/token authorization is in the
backend video feature; this screen must not accept an arbitrary room as permission.
Build checks validate imports; camera/microphone and room membership need browser QA.

The shared `BrandHeader` occupies a separate top row from the media surface.
`scripts/test-web-branding.mjs` checks its layout with a no-media SDK fixture;
it does not validate video signaling or real camera access.
