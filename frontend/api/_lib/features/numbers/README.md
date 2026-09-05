# Numbers and Carrier Access

`phone-number-access.ts` lists assigned caller IDs and verifies their organization
before use. `number-config.ts` handles business line configuration and safe carrier
tags; `trunk-policy-store.ts` controls allowed trunk policy. `carrier-access.ts`
separates platform carrier metadata from company-visible data.

`routes/` contains company number/trunk administration and stable Telnyx number
API implementations. `verified-numbers.ts` requires administrative authorization
for mutations. The public URLs remain under `api/telnyx/` for compatibility.
Test ownership, internal tag filtering and trunk policy through frontend `npm test`.
