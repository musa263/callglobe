# Shared Browser Foundation

`api.js` owns HTTP requests and cookie-session metadata helpers. Feature modules
consume it; it must not import feature screens or initialize calling. Its session
storage tests are colocated. Browser metadata is not proof of authorization;
the server validates the session on every protected operation.

`components/BrandHeader.tsx` uses the existing Vocivo image mark in a 56px top
bar. Web-phone, video and enrollment entry points mount it outside their changing
page content, including login/loading/error states. The web-phone frame offsets
sticky navigation and minimum heights without overlapping content. Run
`node --import tsx scripts/test-web-branding.mjs` with the browser environment
described in CONTRIBUTING for desktop/tablet/phone layout and image checks.
