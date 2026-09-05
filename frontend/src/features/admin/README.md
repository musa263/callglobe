# Administration UI

`AdminConsole.jsx` owns navigation, profile/access loading and page composition.
It is no longer the implementation of every admin screen. Page folders are:

- `overview/`: company dashboard.
- `users/`: users list and tabbed `UserEditor`, including its own `userTabs`.
- `ai/`: voice/receptionist configuration.
- `routing/`: outbound rules, office hours and call handling.
- `numbers/`: company number and trunk setup.
- `diagnostics/`: reports and events.
- `settings/`: system and password/security settings.
- `platform/`: platform dashboard, companies, subscriptions, feature access and API keys.
- `WalletsPage.jsx`: platform/customer wallet management.
- `components/ui.jsx`: shared admin fields, toggles, status, headers and modals.

`configuration.js` contains defaults and navigation metadata, not authorization.
Backend routes remain the security boundary even when the UI hides a page.
Company membership must not grant Vocivo platform privileges. Validate both role
views with browser tests after changing imports, page props or entitlement names.
