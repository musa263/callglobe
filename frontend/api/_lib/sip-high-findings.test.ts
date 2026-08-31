import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { consumeDigestReplay } from './sip-digest.js';
import { outboundPstnChargeMinor } from './wallet-store.js';
import { voiceWalletCharge } from './inbound-billing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

test('High.docx: unauthenticated E.164 INVITE is rejected off the WebSocket edge', () => {
  const cfg = read('services/sip/kamailio/kamailio.cfg');
  assert.match(cfg, /reject unauthenticated E.164 INVITE/);
  assert.match(cfg, /www_challenge\("\$env\(VOCIVO_SIP_REALM\)", "1"\)/);
  assert.match(cfg, /\$du = "sip:127.0.0.1:5080;transport=udp"/);
  const external = read('services/sip/freeswitch/sip_profiles/external.xml');
  assert.match(external, /sip-ip" value="127.0.0.1"/);
});

test('High.docx: conf-* is answered as a FreeSWITCH conference in public context', () => {
  const publicXml = read('services/sip/freeswitch/dialplan/public.xml');
  assert.match(publicXml, /vocivo-conference/);
  assert.ok(publicXml.includes('sip_h_X-Vocivo-Flow') && publicXml.includes('^inbound$'));
  assert.match(publicXml, /conference" data="\$1@default"/);
  assert.match(publicXml, /\(\?!conf-\)/);
  const conferenceIdx = publicXml.indexOf('vocivo-conference');
  const telnyxIdx = publicXml.indexOf('vocivo-telnyx-registered-client');
  assert.ok(conferenceIdx >= 0 && conferenceIdx < telnyxIdx);
});

test('High.docx: in-dialog REFER follows loose_route and Refer-To', () => {
  const cfg = read('services/sip/kamailio/kamailio.cfg');
  assert.match(cfg, /has_totag\(\) && loose_route\(\)/);
  assert.match(cfg, /hdr\(Refer-To\)\{nameaddr.uri.user\}/);
});

test('High.docx: REGISTER digest is bound to the AOR and nonces cannot replay', () => {
  const auth = read('frontend/api/_lib/routes/voice-sip-auth.ts');
  assert.match(auth, /fromUser/);
  assert.match(auth, /toUser/);
  assert.match(auth, /consumeDigestReplay/);
  const kamailio = read('services/sip/kamailio/kamailio.cfg');
  assert.match(kamailio, /fromUser/);
  assert.equal(consumeDigestReplay('ext', 'nonce-1', '00000001'), true);
  assert.equal(consumeDigestReplay('ext', 'nonce-1', '00000001'), false);
});

test('High.docx: SIP credentials reuse HA1 until expiry instead of rotating every login', () => {
  const creds = read('frontend/api/_lib/routes/voice-sip-credentials.ts');
  assert.match(creds, /existing\?\.password/);
  assert.match(creds, /24 \* 60 \* 60 \* 1000/);
  assert.match(creds, /expires_in: 86400/);
});

test('High.docx: outbound PSTN minutes debit; inbound and internal do not', () => {
  assert.equal(voiceWalletCharge('inbound').charged, false);
  assert.equal(voiceWalletCharge('internal').charged, false);
  assert.equal(voiceWalletCharge('outbound').charged, true);
  assert.equal(outboundPstnChargeMinor(30, 10), 10);
  assert.equal(outboundPstnChargeMinor(61, 10), 20);
  assert.equal(outboundPstnChargeMinor(0, 10), 0);
  const webhook = read('frontend/api/_lib/routes/voice-webhook.ts');
  assert.match(webhook, /maybeChargeOutboundHangup/);
});

test('High.docx: RTPEngine and FreeSWITCH no longer share one RTP port range', () => {
  const compose = read('services/sip/docker-compose.yml');
  const fsConf = read('services/sip/freeswitch/autoload_configs/switch.conf.xml');
  assert.match(compose, /RTP_START:-16384/);
  assert.match(fsConf, /rtp-start-port" value="20000"/);
  assert.match(fsConf, /rtp-end-port" value="20100"/);
});

test('High.docx: iOS dialogs, CANCEL, Call-ID, CallKit, hold re-INVITE', () => {
  const engine = read('mobile/modules/vocivo-sip/ios/VocivoSipEngine.swift');
  assert.match(engine, /remoteTag/);
  assert.match(engine, /captureDialog/);
  assert.match(engine, /"CANCEL"/);
  assert.match(engine, /byeId != activeCallId/);
  assert.match(engine, /pendingCallKitAnswer/);
  assert.match(engine, /a=sendonly/);
  assert.match(engine, /digestNc/);
  assert.match(engine, /socket != nil/);
  assert.match(engine, /expires=\\\(contactExpires\)/);
  const media = read('mobile/modules/vocivo-sip/ios/VocivoSipMedia.swift');
  assert.doesNotMatch(media, /localAudio\[target\]\?\.isEnabled = !held/);
});

test('High.docx: Android does not take the iOS-only native SIP path', () => {
  const edge = read('mobile/src/lib/voiceEdge.ts');
  assert.match(edge, /platform === 'ios'/);
  const native = read('mobile/src/lib/sipNative.ts');
  assert.match(native, /Platform.OS === 'ios'/);
});

test('High.docx: sign-out unregisters SIP; Telnyx leftovers skip SIP edge', () => {
  const auth = read('mobile/src/context/AuthContext.tsx');
  assert.match(auth, /unregisterVocivoSip/);
  const voice = read('mobile/src/context/VoiceContext.tsx');
  assert.match(voice, /preferredVoiceEdge\(\) === 'sip'\) return/);
  assert.match(voice, /answerVocivoSip\(waitingCall.id\)/);
});

test('High.docx: web inbound Terminated, waiting INVITE, REFER without mass hangup', () => {
  const sip = read('frontend/src/hooks/useSipVoice.js');
  assert.match(sip, /SessionState.Terminated/);
  assert.match(sip, /incomingRef.current !== invitation/);
  assert.match(sip, /hangupSession\(session\)/);
  assert.match(sip, /canMerge: Boolean\(heldCall && mediaReady && !conference\)/);
  assert.match(sip, /Open this tab again to reconnect/);
  assert.match(sip, /sip-credentials[\s\S]*50 \* 60 \* 1000/);
  assert.ok(sip.includes('sip:\\+?[1-9]\\d{6,14}@'));
  const voice = read('frontend/src/hooks/useVoice.js');
  assert.doesNotMatch(voice, /setEdge\('sip'\)/);
});

test('Medium.docx leftovers: wakeup window, nginx snippet, no public 7443', () => {
  const cfg = read('services/sip/kamailio/kamailio.cfg');
  assert.match(cfg, /\$avp\(tries\) > 20/);
  assert.match(cfg, /lookup\("location"\)/);
  assert.doesNotMatch(cfg, /listen=tcp:0.0.0.0:7443/);
  assert.ok(fs.existsSync(path.join(root, 'services/sip/nginx/vocivo-sip-edge-proxy.conf')));
});
