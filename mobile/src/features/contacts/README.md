# Mobile Contacts

Company rows show the directory's live device lease: green online, amber busy,
gray offline, each with an accessible state label. Phone contacts use their stored
country when present, then the company's dialing country; explicit `+` remains
unchanged. Device locale is only an individual-account fallback.

`contactDirectory.ts` normalizes/searches directory and contact identity;
`screens/ContactsScreen` renders contacts and starts the selected call action.
Company directory authorization belongs to the backend organization feature.
Check duplicate names, missing photos, extension numbers and permission denial.
Run typecheck and calling identity tests when changing selection/formatting.
