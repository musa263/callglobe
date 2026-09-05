# AI Receptionist and Speech

`receptionist.ts::receptionistFor` resolves tenant-specific AI settings and transfer
targets. `transferTargets` uses active directory users. `parseConversation`
validates the conversation contract. `routes/voice-receptionist.ts` is the service
boundary; the streaming conversation runtime is `services/receptionist/`.

`voice-catalog.ts` maps voice IDs and renders prompts through the configured TTS
service. `prompt-prerender.ts` splits/cache-warms prompts; it must not block live
conversation on unrelated long rendering work. `ai-transfer.ts` builds managed
assistant tools/instructions and `ai-transfer-token.ts` signs call-bound transfers.
`routes/admin-ai.ts`, `admin-voices.ts`, `voice-ai-transfer.ts` and `ai-replies.ts`
provide configuration, preview, transfer and reply APIs.

`receptionistFor` also gives the receptionist the tenant's opening hours in
spoken form (`describeOfficeHours` → `officeHoursText`, e.g. "Monday to Friday,
9 am to 5 pm; Saturday, 10 am to 2:30 pm. Closed Sunday.") and the timezone, so
the most common question a receptionist gets is answered rather than transferred.

`receptionistVoice` → `spokenVoice`: a voice the engine's authors grade below
B- (see `voice-catalog.ts` `quality`) is answered by the best-graded voice in
the same language; the admin's choice is kept in the config and honoured again
if the engine improves it. The first tenant went live on Adam (F+), which is
what "sounds fake" was.

Run frontend tests, then receptionist/TTS service suites when modifying speech
flow. Test real playback/transfer separately; a successful JSON reply is not audio.
