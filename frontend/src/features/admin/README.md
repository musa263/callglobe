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

## Customer workspace requests

Opening a customer is a GET, not a saved platform preference. `workspace-api.js`
captures that tab's organization ID and adds `?organizationId=...` to tenant
requests. Pass this client to child pages that call tenant APIs; never infer their
target from a mutable server default. The load generation discards responses from
an earlier workspace, and failed voice-settings loads must not leave another
company's editable voice form behind.

PBX forms retain the returned `config.workspaceVersion` when saving. A stale
same-company form receives HTTP 409; editing another company does not invalidate
it. Global SaaS/wallet actions keep their separate, explicit target contracts.

Regression: `node --import tsx scripts/test-admin-workspaces.mjs` from `frontend`
with `VOCIVO_TEST_ORIGIN` set to the local Vite URL and `PLAYWRIGHT_MODULE` set if
Playwright is installed outside this project. All APIs are intercepted. This
tests two real console tabs, not production carrier calls or production storage.
