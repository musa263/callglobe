# Account-based Mobile Experience

## Membership and Permissions

- Company QR enrolment verifies a signed, single-use invitation. Organization membership and account type come from the stored extension and organization, never the QR scanner UI or a mode switch.
- Dial Pad and Settings do not contain Personal/Business selectors. Cached legacy mode values are not read. The extra Home screen has been removed; history is on Recents.
- Individual accounts cannot use company directories, internal messaging/calling, extension conference participants, SIP trunks, receptionist/IVR, queues, company recordings, reporting, developer API or branding. Regular-number conferences are available under outbound calling permissions. Server entitlements override even an enterprise plan's business-only flags.
- Company employees retain calling features but cannot open company phone administration. Vocivo Superadmin retains platform administration.
- Contacts on the device, external calling, SMS, personal numbers, voicemail and video remain subject to the user's plan, balance and endpoint permissions.

## Phone OTP Flow

`mobile/src/features/auth/screens/PhoneSignupScreen.tsx` calls `/api/auth/phone` with `step: start`, name and an explicit international phone number. The backend validates the number and country, reserves distributed phone/IP/global send quotas, and requests Telnyx Verify SMS delivery. It returns only an opaque challenge ID and expiry, never the OTP or provider response.

`step: verify` submits that challenge ID and code. A database transaction claims the challenge before provider verification. Only an accepted response for the stored number can consume it. Replays, concurrent verification, expired codes and exhausted attempts fail closed.

The verified number maps to a separate individual identity, never an existing company user found by phone number. First signup creates an individual organization, its subscription and calling credential through the existing provisioning service. Subsequent logins revalidate the stored organization, role and active extension. No company administrator is created; no DID or caller ID is allocated just because a number was verified.

Phone identities, verification records and rate buckets are AES-GCM encrypted in private database objects. Lookup keys use HMAC. The application session remains in the mobile Keychain/Keystore. OTP provider error bodies are not logged.

## Activation Gates

Live delivery is **disabled by default**. Set server-side variables only after reviewing the launch configuration:

- `VOCIVO_PHONE_SIGNUP_ENABLED=true`
- `TELNYX_VERIFY_PROFILE_ID`: the production Telnyx Verify SMS profile.
- `VOCIVO_INDIVIDUAL_PLAN_ID`: an active, zero-monthly-price plan created by Vocivo Superadmin. This is a signup gate, not free PSTN credit; calls still require the existing wallet/caller-ID checks. Paid subscriptions need a separate checkout and consent flow.
- `VOCIVO_OTP_COUNTRIES`: explicit ISO country allowlist, for example `GB,US`. No countries are enabled by default.
- `VOCIVO_OTP_DAILY_LIMIT`: rolling 24-hour global send ceiling, default 100. Also configure provider fraud/spend controls.
- Existing `TELNYX_API_KEY`, `AUTH_SECRET` and Postgres settings must be valid.

The rate limits are five sends per phone per hour, sixty-second resend cooldown, twenty sends per IP per hour, thirty verification submissions per IP per ten minutes and five attempts per challenge. Failed sends count against quotas. Codes expire after five minutes.

## Provisioning Recovery and Release Verification

Carrier provisioning is not one database transaction. A durable identity reservation prevents duplicate credentials across serverless instances. If a process crashes or carrier creation has an ambiguous outcome, the identity stays `provisioning` and future attempts stop for support reconciliation. Operators must reconcile the reserved organization against the carrier/directory before making it ready; do not blindly delete a reservation and retry. This intentionally favors safety over unattended recovery.

Deploy the backend before distributing the mobile build. Validate live SMS delivery, the complete first-signup path, subsequent login, suspended-account refusal, zero wallet balance, and access denial for all company APIs in a staging account before enabling public signup. No live SMS, real account provisioning, or physical-device OTP auto-fill was exercised by the local mocked tests. The new flow is not yet activated in production.

SMS possession is susceptible to number recycling and SIM swaps. Do not use this personal flow for company-admin or platform-admin recovery. Plan stronger recovery/step-up authentication before allowing sensitive account changes.

Private OTP records have logical expiry but no new retention scheduler. Add a bounded cleanup job for expired `challenge/` and `rate/` objects before a public rollout; preserve `identity/` records and never erase active provisioning reservations. Monitor aggregate verification/provisioning failures without logging names, numbers or codes.

Provider reference: https://developers.telnyx.com/api-reference/verify/verify-verification-code-by-id
