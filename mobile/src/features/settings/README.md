# Mobile Settings

`screens/SettingsScreen` coordinates user settings, account/security actions and
ringtone choices using existing contexts/API helpers. Audio preview implementation
is in calling/media/ringtone. Auth owns sign-out; company configuration belongs
to organizations. Validate save errors, preview cleanup and logout, then typecheck.
