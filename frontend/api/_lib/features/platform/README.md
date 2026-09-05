# Platform Administration

`platform-key-store.ts` creates scoped keys, stores their hashes, authenticates
requests and revokes keys. `publicPlatformKey` removes secret material from output.
`routes/platform-resource.ts` implements the external platform resource API.
`routes/admin-api-keys.ts`, `admin-background.ts` and `admin-events.ts` provide
key management, delivery diagnostics and event views.

These are privileged operations, not default company-admin capabilities. Check
role, scope and explicit organization selection at each entry point. Never expose
raw credentials in diagnostic payloads. Run frontend API typecheck and tests.
