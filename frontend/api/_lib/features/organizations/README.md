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

## Explicit admin tenant scope

After verifying authentication, tenant admin routes call
`request-organization.ts::requestOrganizationId`. Superadmins must send a single
`organizationId` query parameter. Company users default to their verified tenant
and cannot override it. Only the initial read-only PBX GET may choose the saved
default; no tenant mutation may do so. An old unscoped superadmin client fails
closed and must reload the current UI. Platform SaaS and wallet routes remain
separate from customer navigation.

`admin-pbx.ts` saves only the selected company's settings, organization record and
user profiles. The returned `workspaceVersion` guards the form's loaded revision;
the store's transactional `expectedUpdatedAt` guards changes during the request.
AI and business voice use their dedicated routes and are not overwritten by a
general PBX form. Workspace selection never changes global `activeOrganizationId`.
