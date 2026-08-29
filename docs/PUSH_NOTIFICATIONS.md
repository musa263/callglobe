# Telnyx Native Call Push

Vocivo does not generate or dispatch a custom call-push payload. Incoming-call wakeups are owned by Telnyx and delivered through the native Telnyx SDK integration:

- iOS uses the PushKit token supplied in the Telnyx login configuration.
- Android uses the Firebase Cloud Messaging token supplied in the Telnyx login configuration.
- A token refresh is persisted by the native bridge and registered with Telnyx on the next safe login or foreground recovery.
- Signing out disables push registration, clears local Telnyx credentials, and marks the native device as signed out so stale pushes cannot display a call.

The app passes Telnyx push data directly to the Telnyx SDK, which coordinates CallKit or the Android incoming-call notification.

## Release Verification

Validate on physical devices before release:

1. Register the same extension on two devices and confirm simultaneous ringing.
2. Repeat with the app foregrounded, backgrounded, terminated, and the phone locked.
3. Sign out, terminate the app, and confirm that the former account no longer rings.
4. Rotate the FCM token and confirm the refreshed token is used after native recovery.
5. Answer on one device and confirm every other device dismisses the incoming UI.
