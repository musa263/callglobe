import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import { carrierGateway } from '../numbers/carrier-runtime.js';
import { createVoiceRouteToken, verifyVoiceRouteToken } from '../calling/voice-route-token.js';
import { parseXmlCurlRequest } from './sip-dialplan.js';
import { renderSipOutbound } from './sip-outbound-dialplan.js';

process.env.AUTH_SECRET = 'byoc-route-test-only';
const carrier = { trunkId: '12345678-1234-1234-1234-123456789012', revision: 3, channelLimit: 5,
  gateway: carrierGateway({ organizationId: 'primary', id: '12345678-1234-1234-1234-123456789012', revision: 3 }) };
const grant = { routeId: 'authorized-route-123456789', organizationId: 'primary', destination: '+966135550000', callerId: '+966135110000',
  flow: 'outbound' as const, carrierTrunkId: carrier.trunkId, carrierRevision: carrier.revision, carrierGateway: carrier.gateway };
function request(token = createVoiceRouteToken(grant)) {
  return parseXmlCurlRequest({ section: 'dialplan', 'Caller-Destination-Number': grant.destination,
    'variable_sip_h_X-Vocivo-Flow': 'outbound', 'variable_sip_h_X-Vocivo-Caller-ID': grant.callerId, 'variable_sip_h_X-Vocivo-Route-Token': token });
}
test('a signed carrier route bridges only the selected gateway with intact codecs and a call limit', async () => {
  const xml = await renderSipOutbound(request(), defaultPbxConfig(), async () => carrier);
  assert.match(xml, new RegExp(`sofia/gateway/${carrier.gateway}/\\+966135550000`));
  assert.match(xml, /absolute_codec_string=PCMU,PCMA,OPUS/);
  assert.match(xml, /application="limit"/);
  assert.doesNotMatch(xml, /telnyx|\{origination/);
  assert.equal(verifyVoiceRouteToken(createVoiceRouteToken(grant))?.carrierGateway, carrier.gateway);
});
test('stale or forged carrier grants never fall back to a managed gateway', async () => {
  for (const req of [request('invalid'), request(createVoiceRouteToken(grant, -1)), { ...request(), destinationNumber: '+966135550001' },
    { ...request(), vocivoCallerIdHeader: '+966135110001' }, { ...request(), vocivoFlowHeader: 'inbound' }]) {
    assert.doesNotMatch(await renderSipOutbound(req, defaultPbxConfig(), async () => carrier), /application="bridge"/);
  }
  assert.doesNotMatch(await renderSipOutbound(request(), defaultPbxConfig(), async () => ({ ...carrier, revision: 4 })), /application="bridge"/);
  assert.doesNotMatch(await renderSipOutbound(request(), defaultPbxConfig(), async () => null), /application="bridge"/);
});
test('managed calls remain explicit and cannot be switched to BYOC after reservation', async () => {
  const token = createVoiceRouteToken({ ...grant, carrierTrunkId: undefined, carrierRevision: undefined, carrierGateway: undefined });
  assert.match(await renderSipOutbound(request(token), defaultPbxConfig(), async () => null), /sofia\/gateway\/telnyx\//);
  assert.doesNotMatch(await renderSipOutbound(request(token), defaultPbxConfig(), async () => carrier), /application="bridge"/);
});
