# Scheduled Calls

`routes/voice-meetings.ts` is exposed through `/api/voice/meetings`. GET lists
the signed-in user's schedule; POST creates, PATCH edits with `version`, and
DELETE removes with `id`/`version`. Organization/owner fields in request bodies
never select storage. Platform accounts cannot use a customer's calendar.

`meeting-store.ts` validates destinations, dates, IANA time zones and bounded
text. AES-GCM records bind authenticated ownership into AAD and a hashed private
path, one row per company/user. `transactObject` serializes writes in Postgres
with advisory/row locks and etag CAS; per-meeting versions reject stale edits.
Repeated creates with the same ID and payload are idempotent. The maximum is
200 saved meetings per user; deleting old meetings frees capacity.

Internal destinations must match the same company's active directory; video
rooms require current feature access and matching room ownership. Scheduling
does not reserve balance, place a call, send email, or authorize a later call.
Start uses the existing phone route/video token API and rechecks access then.
Calendar files provide reminders in the user's calendar client, not a server job.

Run backend type checking and `npm test`. Store tests use a serialized storage
fixture, not a live Postgres instance; production database/concurrency acceptance
remains a deployment gate. Do not claim fixture tests tested live SIP or billing.
