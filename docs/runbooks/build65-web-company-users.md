# Version 1.0.0 (65): web calling and company accounts

The web phone now refreshes assigned numbers without waiting for account billing
bootstrap. Carrier DIDs stay visible, selected numbers are reconciled against the
latest inventory, and failures offer retry. Pending carrier connections remain
unable to place public calls. Internal calling uses a tenant directory match in
the same input; the External/Extension mode controls have been removed.

Company administrators can create employees with an email and temporary password
for web/mobile sign-in. Employees must change that password at first login and
cannot administer the company. Existing QR-only users remain valid and can enable
web sign-in by setting a password. No real employee was invented or messaged for
the test, and no production test account was created.

The existing account table now also stores employee/manager roles; no SQL schema
change is required. Do not roll back to older writers after enabling employee
accounts without reviewing their administrator counting and role assumptions.
Login and each account session validate the current linked extension, status,
tenant and role. New session generations bind to the account password hash.

## Verification

- `bash verify.sh`: 442 backend/web tests, 154 mobile unit tests and 71 mobile
  integration tests passed, plus API/mobile type checks and the web build.
- Full-App browser: all five carrier choices, pending/ready behavior, number
  refresh failure/retry, automatic extension routing, session restoration,
  ringing, cancellation and audio recovery passed.
- Employee form: ordinary role exposes email/password fields and submits them
  without requesting administrator access. API/session fixtures verify role and
  tenant denials, duplicate email, password reset and deletion.
- Existing SIP browser lifecycle regression passed. These browser/API tests use
  local fixtures; they do not establish a production database or real call pass.
- Native iOS Release build succeeded. `codesign --verify --deep --strict` passed
  using the host certificate trust store. App identity is `app.vocivo.mobile`,
  version `1.0.0`, build `65`, development APNs, provisioned for the existing test
  device. The IPA is a development installation artifact, not a TestFlight upload.

The local artifact is saved under ignored `tmp/releases/vocivo-1.0.0-65/` in the
user workspace. Native source was regenerated through Expo; generated projects,
signing material and binaries are excluded from Git. The build uses the production
API URL. Go Telecom activation, physical device acceptance, Android binary
distribution and TestFlight submission are not established by this build.
