# Organizations and Access

`pbx.ts::listExtensions` loads the directory for an organization and resolves
the active engine's credential requirements. `createExtension`, `updateExtension`
and `deleteExtension` coordinate directory/credential changes. Tenant-sensitive
callers must supply the expected organization, not trust a client extension ID.

`tenancy.ts` resolves session ownership. `pbx-config-store.ts` reads company
settings and saves version-checked updates. `saas-store.ts` separates platform
catalog operations from `readTenantSaasState`; `effectiveEntitlements` combines
plan and feature overrides. `saas-access.ts` is the route-facing access gate.

`office-hours.ts` and `user-call-routing.ts` determine availability/destinations.
`routes/` exposes company users, PBX settings, SaaS controls and the voice directory.
Colocated tests cover tenant scope, role handling, hours and routing. Use frontend
`npm test` plus `npm run check:api`.
