# Shared Backend Primitives

`http.ts` handles transport validation/responses. `object-store.ts` owns database
connections, retry, transaction, CAS and tenant-context storage operations;
`tenant-storage.ts` identifies tenant-owned records. `stored-object-read.ts`
distinguishes absence from read failures. Feature stores wrap these primitives.

`telnyx.ts` is the carrier REST adapter; `telnyx-webhook-auth.ts` verifies signed
events. `security-quarantine.ts` isolates unresolved events from customer records.
No shared helper may import a web/mobile screen. Test transaction/tenant behavior
through the colocated tests and database integration checks before schema changes.
