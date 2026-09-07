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

`/api/admin/carrier-trunks` exposes GET/PUT for company administrators in their
authenticated organization, or a platform administrator with an explicit customer
workspace. The route checks the `sipTrunks` entitlement and validates extension,
ring group, queue and IVR destinations against that company. Unassigned destinations
are supported so administrators can enter their carrier details before routing.

`carrier-trunk-store.ts` normalizes the provider, account reference, endpoint,
transport, public IP, authentication method and individual DID/caller-ID pairs.
It stores encrypted, tenant-specific objects using the shared transactional store.
Revisions reject stale edits with 409; repeated identical creates are idempotent.
Malformed or moved encrypted data fails closed instead of resetting configuration.

These records are drafts, displayed as **Pending activation**. Saving does not
provision SIP credentials, modify number assignments, authorize a carrier source,
or change a FreeSWITCH gateway. Provider authentication, secure credential
provisioning when required, edge integration and real carrier call verification
remain activation gates. An account reference is not treated as a SIP username.
The existing `/api/admin/trunks` Telnyx external-PBX registration contract is separate.

Carrier drafts also support a main trunk number, optional outbound proxy/port,
simultaneous call limit and explicit inbound/outbound permissions. The main number
must exist in that trunk's DID list. Older records without these fields remain
readable and display unspecified values; missing permissions do not imply enabled
calling. These fields remain configuration data until SIP edge activation.

Regression: `node --import tsx --test api/_lib/features/numbers/carrier-trunk-store.test.ts`
from `frontend`, then root `bash verify.sh`. The tests use encrypted in-memory
persistence and real route logic; they do not connect to a carrier.
