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

## One owner per delivery address

A mobile push token or browser subscription endpoint belongs to one current
extension across all tenants. `push-ownership-store.ts` atomically stores its
private ownership pointer with the encrypted registration. A newer login moves
ownership; a delayed older write cannot reclaim it. Delivery lists filter by
both the exact record path and its registration generation.

Previously, the same address could remain under 2000 after signing into 2003.
Calling 2000 then sent an incoming alert to the caller's device as well. Missing
ownership pointers are repaired from paginated legacy records using the latest
registration time, so existing duplicates are handled without a mobile update.
Equal-time legacy ownership conflicts fail closed until re-registration. The
legacy scan is bounded to 20,000 objects and refuses incomplete migrations.

Deletion retains an ownership tombstone, preventing older registrations from
becoming eligible again. Provider cleanup includes the observed registration
time so a late failure cannot delete a refreshed registration. The ownership
index contains only a private record path/time, never the raw push token or keys.

`push-ownership-store.test.ts` exercises real encrypted iOS, Android and browser
records across account switches, legacy migration, pagination, concurrent writes,
late deletion and re-registration. Physical incoming-alert delivery still needs
a call retest after deployment; fixtures do not contact APNs/FCM or place calls.
