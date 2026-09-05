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

Run frontend tests, then receptionist/TTS service suites when modifying speech
flow. Test real playback/transfer separately; a successful JSON reply is not audio.
