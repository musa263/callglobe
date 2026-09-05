# Messaging

`routes/messages.ts` authorizes send/list operations. `routes/messaging-webhook.ts`
verifies carrier events and resolves phone-number ownership before storage.
`message-store.ts::storeMessageEvent` persists an idempotent event;
`listStoredMessages` scopes the result by organization and optional viewer extension.
`messageForViewer` controls the customer-visible representation.

Unassigned incoming numbers must not become another tenant's messages. Signing
and quarantine primitives live under `_lib/shared/`. Run the colocated store
tests with frontend `npm test`; live SMS acceptance needs an assigned SMS-capable line.
