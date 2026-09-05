# Browser Video

`main.jsx` is loaded by `video.html` and coordinates the video-room SDK/UI.
`video.css` contains meeting-specific layout. Room/token authorization is in the
backend video feature; this screen must not accept an arbitrary room as permission.
Build checks validate imports; camera/microphone and room membership need browser QA.
