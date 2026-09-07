# Stage 1 platform ownership — September 8, 2026

Vocivo owns the platform. Global Heritage is a business tenant. The Stage 1
extension-authority adoption applies to the encrypted shared directory, with
tenant IDs retained on every identity; it is not a Global Heritage feature flag.

## Verified boundaries

| Control | Authority and scope |
| --- | --- |
| Extension authority migration | Deployment operation against the platform directory; no tenant HTTP mutation |
| Calling engine, SIP domain and inbound enablement | Platform deployment configuration, independent of selected customer |
| Superadmin authentication | Verified `vocivo-owner` subject and platform role; a company owner is not a superadmin |
| Customer subscriptions, plans and feature overrides | Vocivo superadmin |
| Extension creation/edit/deletion | Vocivo service; tenant admins restricted to their organization, roles and seat limits |
| SIP credentials and internal calls | Bound to the signed-in tenant extension; platform administrator cannot acquire a calling extension implicitly |
| Company PBX, routing and receptionist | Tenant settings under Vocivo administration and delegated company permissions |
| Historical top-level PBX settings | One explicitly pinned legacy tenant; this is not platform ownership |

Read-only production inspection at 2026-09-07 20:24:46 UTC (September 8 in
Dubai) found directory revision 3 with `authority: vocivo`, platform control
plane `vocivo`, and Global Heritage (`primary`) as a business tenant with three
extensions. The directory roles were `company_owner` and `user`; there were no
orphaned tenant references. No employee credentials or contact details were
printed, and no production record was changed by this inspection. Ownership
resolution used normalized configuration; this does not prove the legacy pin
was already persisted in the stored record.

## Corrections

- Removed Global Heritage branding from fresh PBX/receptionist defaults and the
  admin console's initial voice form. Existing stored customer data is retained.
- Pin historical settings ownership while normalizing old configuration, before
  a save can reorder companies. The next normal save persists the pin. A missing
  explicitly pinned tenant fails closed rather than handing settings to another.
- Added regressions preserving Global Heritage data across normalization and
  reordering, preventing its content from becoming another tenant's defaults,
  and proving its admin cannot overwrite platform authority, another company or
  its assigned extension capacity through a PBX form.

## Validation and limits

The full application gate passed 421 backend/web, 150 mobile unit and 55 mobile
integration tests (626 total), plus API/mobile typechecks and the web build.
Focused directory, tenancy and admin tests passed 31 checks. The real-browser
admin workspace harness also passed: two superadmin tabs, isolated AI/menu
saves, read-only workspace selection and scoped refresh/tenant reads.
These checks establish software boundaries; they do not close physical calling
acceptance. Build 63 remains installed awaiting the user's readiness for the
call retest. No calls or production tenant mutations were performed for this audit.
