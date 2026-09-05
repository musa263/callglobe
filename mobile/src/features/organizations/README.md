# Mobile Company Workspace

`BusinessContext` loads the current company's configuration/directory and exposes
business-mode data to screens. It uses authenticated APIs; locally selecting
Business mode must not grant a different organization's identity or entitlements.
Backend organizations owns company/extension changes and feature authorization.

Test refresh, empty organization, role-limited data and logout. Do not move SIP
registration into this context; that is calling/engine/useVoiceRegistration.
