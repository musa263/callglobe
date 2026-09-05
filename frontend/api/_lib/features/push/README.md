# Push Delivery

`routes/voice-devices.ts` registers/deletes the authenticated extension's device.
`push-device-store.ts` and `web-push-store.ts` retain tenant/extension ownership.
`mobile-push.ts` builds native VoIP/FCM payloads and validates provider config;
`mobile-push-dispatcher.ts` sends them. `web-push-dispatcher.ts` sends browser
notifications to subscriptions registered by `routes/voice-web-push.ts`.

The Vocivo SIP wake path comes from `sip/routes/voice-sip-wakeup.ts`. Telnyx SDK
native delivery also requires its own provider registration; payloads are not
interchangeable. Dead provider tokens are retired, not retried indefinitely.
Use payload/config tests in frontend `npm test`; physical background delivery
requires device/provider verification beyond mocked HTTP responses.
