# Feature Layout Release - 2026-09-05

## Scope

- Integrated GitHub main through `0794625` with the SIP fixes in `249ccbd`.
- Merge `80ed163` preserves the newer ACK/media, AI streaming, preview removal,
  account authorization and mobile history/registration changes.
- Relocated 272 existing modules/assets and extracted web phone/admin components
  into feature folders. Public API paths and native build entry points remain stable.
- Added feature READMEs, a cross-runtime feature directory and recursive unit-test
  discovery. Existing source bodies were retained during component extraction.
- Unrelated local patch files were excluded from the release.

## Validation

- Root `bash verify.sh`: API/mobile type checks, 307 backend/web tests,
  102 mobile unit tests, 12 mounted integration tests, and Vite/PWA build passed.
- Browser SIP harness: six lifecycle/ringback/cancellation/failure scenarios passed.
- Browser startup harness: eight startup, registration, incoming call, audio retry,
  unavailable notice and invalid-session scenarios passed at desktop/mobile sizes.
- Admin browser harness: 18 superadmin and 13 company-admin navigation pages plus
  both user editors rendered without page errors, using intercepted test APIs.
- The local real sign-in page was opened and inspected. Browser fixtures make no
  actual carrier calls and are not production signaling substitutes.

## SIP Deployment

GitHub Actions run `33957918420` deployed the SIP config from `80ed163` via the
temporary `codex/sip-hardening-release` branch before production API promotion.
The pinned Kamailio 5.8.4 image reported `config file ok`; 11 FreeSWITCH XML files
parsed. The previous server tree is backed up at
`/opt/vocivo/sip-backups/20260905092512` on the SIP host.

Post-restart health run `33959112350` showed FreeSWITCH healthy, Kamailio,
RTPEngine and coturn running, and the Telnyx gateway UP. No FreeSWITCH calls were
active at the status checks. This is control-plane/container evidence, not proof
of successful bidirectional audio on customer hardware.

## Remaining Acceptance and Operational Notes

- New native code requires a separate TestFlight/APK build. This Vercel release
  does not update installed mobile binaries.
- Physical killed-state wake, simultaneous-device cancellation, in-dialog media
  recovery and actual two-way audio still need device/carrier acceptance tests.
- SIP conference/REFER entry intentionally fails closed pending authorized room
  admission. It is not a completed SIP conferencing feature.
- FreeSWITCH reported scheduler/nice privilege warnings at startup but became
  healthy. Do not grant broad container privileges merely to hide these warnings.
- The status workflow reports host UFW inactive. That does not establish whether
  a DigitalOcean cloud firewall is attached; verify cloud firewall rules separately.
- The bundled vendor chunk remains above Vite's size warning threshold. The build
  succeeds; this change does not certify performance/capacity or remove all debt.
