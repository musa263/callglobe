# Messaging

`routes/messages.ts` authorizes send/list operations. `routes/messaging-webhook.ts`
verifies carrier events and resolves phone-number ownership before storage.
`message-store.ts::storeMessageEvent` persists an idempotent event;
`listStoredMessages` scopes the result by organization and optional viewer extension.
`messageForViewer` controls the customer-visible representation.

Unassigned incoming numbers must not become another tenant's messages. Signing
and quarantine primitives live under `_lib/shared/`. Run the colocated store
tests with frontend `npm test`; live SMS acceptance needs an assigned SMS-capable line.

`telnyx-message-event.ts` preserves carrier event IDs and occurrence timestamps,
maps recipient delivery failures/delivery confirmation, and marks terminal events.
`message-store.ts` merges them transactionally into encrypted v4 per-message
records and one recent-history entry per message. Older nonterminal events and
late send responses cannot replace terminal outcomes. Duplicate deliveries do
not create history entries. The tenant and message ID are checked at the merge.

Existing v3 events remain available while they migrate in bounded 50-event pages
per history request, with five concurrent projection writes. A transactional
checkpoint prevents overlapping migrations from moving the cursor backwards.
This preserves legacy history without requiring a full-history rewrite inside
one serverless request. Live database migration latency remains a rollout check.
