# Browser Enrollment

`main.jsx` is the entry loaded by `enroll.html`; it parses the enrollment link and
submits it to the authenticated enrollment workflow. `enroll.css` owns this page's
styles. Backend enrollment verifies expiry, ownership and single-use redemption.
Run web build and test invalid, expired and already-used links without printing tokens.

The shared `BrandHeader` remains at the top even for incomplete setup links.
`scripts/test-web-branding.mjs` checks desktop/tablet/phone layout without
redeeming an enrollment token or opening the native app.
