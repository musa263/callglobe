# Web Authentication

`Login.jsx::Login` submits credentials and renders validation feedback. The App
composition root restores the cookie session before exposing protected features.
`src/shared/api.js` owns HTTP and session helpers; backend auth owns verification,
rate limiting and role claims. No preview login bypass exists in the product UI.

Voice configuration is fetched alongside session verification, using the current
session object as its request owner. This authenticated read is not proof of a
verified UI identity: neither calling engine starts until the profile is verified.
Account/bootstrap details remain off the phone-registration critical path.

Test with `scripts/test-web-startup.mjs` and frontend build. Never add passwords
or bearer-token persistence to this component to work around session failures.
