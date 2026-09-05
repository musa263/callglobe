# Web Settings

`SettingsView` renders personal settings and invokes existing API actions.
Administrative security settings are separately in admin/settings. Do not duplicate
auth, password validation or provider initialization in this view. Test save
failures and session expiry as well as successful updates; run the frontend build.
