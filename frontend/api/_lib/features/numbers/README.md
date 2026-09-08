# Numbers and Carrier Access

`phone-number-access.ts` lists assigned caller IDs and verifies their organization
before use. `number-config.ts` handles business line configuration and safe carrier
tags; `trunk-policy-store.ts` controls allowed trunk policy. `carrier-access.ts`
separates platform carrier metadata from company-visible data.

`routes/` contains company number/trunk administration and stable Telnyx number
API implementations. `verified-numbers.ts` requires administrative authorization
for mutations. The public URLs remain under `api/telnyx/` for compatibility.
Test ownership, internal tag filtering and trunk policy through frontend `npm test`.

## Company carrier configurations

`/api/admin/carrier-trunks` exposes GET/PUT/PATCH for company administrators in their
authenticated organization, or a platform administrator with an explicit customer
workspace. The route checks the `sipTrunks` entitlement and validates extension,
ring group, queue and IVR destinations against that company. Unassigned destinations
are supported so administrators can enter their carrier details before routing.

`carrier-trunk-store.ts` normalizes the provider, account reference, endpoint,
transport, public IP, authentication method and individual DID/caller-ID pairs.
It stores encrypted, tenant-specific objects using the shared transactional store.
Revisions reject stale edits with 409; repeated identical creates are idempotent.
Malformed or moved encrypted data fails closed instead of resetting configuration.

An unpublished record remains a draft. PATCH `use-carrier-numbers` atomically
publishes its DIDs and sets company carrier mode. PUT edits to a published trunk
also update its destinations. Passwords remain encrypted; company responses expose
only `hasPassword`. No company request can authorize a carrier source or declare
a gateway deployed. Connection status comes from the operator deployment record.
The existing `/api/admin/trunks` Telnyx external-PBX registration contract is separate.

Carrier drafts also support a main trunk number, optional outbound proxy/port,
simultaneous call limit and explicit inbound/outbound permissions. The main number
must exist in that trunk's DID list. Older records without these fields remain
readable and display unspecified values; missing permissions do not imply enabled
calling. These fields remain configuration data until SIP edge activation.

Regression: `node --import tsx --test api/_lib/features/numbers/carrier-trunk-store.test.ts`
from `frontend`, then root `bash verify.sh`. The tests use encrypted in-memory
persistence and real route logic; they do not connect to a carrier.

## Tenant BYOC calling

Operator deployment records may include a canonical UTC `expiresAt` deadline
for a temporary test. Expired records stop outbound grant/bridge admission and
inbound resolution; invalid deadlines fail closed. An empty `inboundSources`
array permits an outbound-only test and explicitly reports inbound as undeployed.
It must not be used to claim an incoming carrier route exists.

`carrier-number-service` publishes canonical ownership and disabled tombstones.
`carrier-runtime` checks the operator deployment allowlist, source-bound inbound
aliases, current revisions and explicit call direction. `carrier-gateway-config`
exports a deterministic per-tenant gateway; it does not activate it. See the
[activation runbook](../../../../../docs/runbooks/tenant-carrier-trunks.md).
Run carrier store/runtime/number-service regressions and the SIP outbound XML
regressions, then root `bash verify.sh` and the Docker carrier workflow.
# Administrator-assigned outgoing line

`dialing-defaults.ts` resolves a user's saved caller ID, then the company default,
only against enabled same-tenant number assignments. Carrier mode excludes managed
numbers. Its country comes from the matching published trunk's main DID/caller ID
pair, with the assigned E.164 number as fallback. No device locale guesses are used
for business calls. Mobile bootstrap and number inventory publish these defaults.
`voice-route` chooses them server-side, and `assertCallerIdForSession` also rejects
unassigned overrides on conference/call paths. Admin PBX saves validate changed
user/default lines against current ownership before the existing CAS save.
