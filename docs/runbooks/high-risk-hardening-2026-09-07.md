# High-risk hardening: Build 58 follow-up

Baseline: `a367f11`. Scope: high-risk batch only. Medium and low batches have not started.
User reports absent ringing and two-way audio for iPhone-to-iPhone, iPhone-to-web and external calls.
These are local source changes, not an update to the installed Build 58 binary or live server.

## Implemented locally

| Area | Defect and change | Validation boundary |
| --- | --- | --- |
| iOS audio | The bundled carrier module enables WebRTC manual-audio mode, but Vocivo's own CallKit delegate never activated WebRTC audio. Forward CallKit activation/deactivation to RTCAudioSession and enable/disable the audio unit. Configure voice-chat audio under the WebRTC configuration lock. | Native manager type-check; real-device microphone, earpiece, speaker and Bluetooth tests remain required. |
| Ringback | VoiceContext's ringback functions were no-ops. Forward actual SIP 180 responses to native ringback playback. Stop for 183 early media, answer, hangup, disconnect and teardown; ignore late progress after termination begins. | Regression tests use the real SIP bridge and call-UI binding with mocked session/native boundaries. They do not measure audible output. |
| iOS answer lifecycle | An in-app SIP answer did not request CallKit's Answer transaction. A delayed incoming-report callback could install a ringing deadline after answering. Track accepted calls, avoid duplicate Answer transactions, and prevent rearming answered-call deadlines. | Native build validation and physical-device answer races are separate gates. |
| Registration authorization | A valid SIP digest alone allowed registration after employee or tenant access changed. Check the current directory, tenant status, subscription/plan, admin association and an uncached session-revocation record. Store session issue time and admin account ID with new credentials. | API tests cover suspended/deleted/moved users, renamed SIP identity, revoked sessions, removed admins and missing subscription/plan. No Telnyx provisioning call is added to REGISTER. Existing registered contacts are not actively evicted by this change. |
| Conference provider | The conference endpoint always originated Telnyx calls even when the host used Vocivo SIP credentials. Reject the unsupported provider before originating any carrier legs. | Containment only. This does not implement SIP conferences or make the conference feature production-ready. |
| TURN credentials and capacity | The API had no credential generator for the deployed Vocivo coturn secret. Add expiry-bound HMAC credentials for explicitly configured Vocivo relay URLs; expand the configurable relay range from 49 ports to 49152-65535 by default. | Unit tests verify expiry, HMAC, subject separation and secret redaction. No real TURN allocation or firewall/TLS deployment has been tested here. |

## Local checks

- Mobile: 128 unit tests and 42 mounted integration tests pass.
- Backend/web: 353 tests pass, including the authenticated conference-provider guard.
- Mobile and API TypeScript checks pass.
- Frontend production build passes; the existing large vendor-chunk warning remains.
- iOS and Android Expo prebuild pass without tracked package metadata changes.
- Android `:app:compileDebugKotlin --offline` passes.
- Swift audio-manager type-check and full Xcode simulator build pass, including both modified Swift files and the Objective-C bridge.
- The compiled app installs and launches on the iPhone 17 Pro simulator. The existing local UI fixture displays the Dial Pad and bottom navigation. This fixture makes no live calls and is not audio verification. The bundled `vocivo_classic.wav` asset is present in the compiled app.
- Docker is unavailable locally, so the compose configuration was not container-tested.

## High-risk release gates still open

1. Build and install a new native iOS binary. JavaScript-only or Vercel deployment cannot fix Build 58's native audio bridge.
2. Test iPhone-to-iPhone, iPhone-to-web, and external calls in both directions. Confirm audible ringing, immediate stop on answer, speech in both directions, and teardown on both ends. Record call IDs/timestamps and media statistics without credentials.
3. Repeat with locked/background apps, Wi-Fi/cellular handovers, speaker and Bluetooth. Simulator UI success is not evidence of physical-device PushKit or audio reliability.
4. Deploy the registration API, then verify active and revoked accounts against the live registrar. Credential refresh may be needed for legacy records missing issuance metadata. Verify policy for immediate eviction of already-registered revoked contacts separately.
5. Set API `VOCIVO_TURN_URLS` and `VOCIVO_TURN_SECRET` together. The latter must exactly equal the server's `TURN_SECRET`. Do not rotate the server alone. Only advertise relay URLs that have been allocation-tested.
6. Open the configured relay UDP range in both host and cloud firewalls, verify non-overlap with media ports, and test authenticated TURN allocation and two-way RTP.
7. TURN TLS remains unimplemented/unverified in the active compose file (`--no-tls`). A certificate and listener/routing plan are required. Do not bind TURN to HTTPS port 443 without resolving the existing proxy listener. Test 5349 or a separately routed 443 endpoint before advertising `turns:` URLs.
8. Implement and verify tenant-authorized SIP conferences before re-enabling that provider's conference creation. The current fail-closed response is not feature completion.

The high-risk batch is not cleared until the remaining gates pass. At the initial validation checkpoint these changes were local only. The subsequent Recents correction and requested Git/Vercel release do not clear the native-device, SIP conference or relay deployment gates. TestFlight and SIP-server deployment remain separate from the web/API release.
