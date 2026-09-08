import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCarrierTrunk, type CarrierTrunk } from './carrier-trunk-store.js';
import { carrierDeployments, carrierGateway, carrierReadiness, resolveCarrierOutbound, resolveInboundNumber } from './carrier-runtime.js';
import { renderCarrierGateway } from './carrier-gateway-config.js';
import { applyCarrierNumbers } from './carrier-number-service.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';

export function carrierFixture() {
  const trunk: CarrierTrunk = { ...normalizeCarrierTrunk({ id: '12345678-1234-1234-1234-123456789012', name: 'Example', provider: 'Carrier',
    server: '192.0.2.20', port: 5060, transport: 'UDP', publicIp: '198.51.100.10', authentication: 'ip',
    channelLimit: 5, inboundEnabled: true, outboundEnabled: true,
    numbers: [{ inboundNumber: '0135110000', callerId: '+966135110000', destinationType: 'main' }] }, 'primary'), revision: 1, updatedAt: '2026-09-08T00:00:00Z' };
  const base = defaultPbxConfig();
  const config = { ...base, ...applyCarrierNumbers(base, 'primary', trunk) };
  const deployment = renderCarrierGateway(trunk, '', trunk.publicIp, [trunk.server]).deployment;
  return { trunk, config, deployment, did: trunk.numbers[0].callerId };
}

test('carrier admission requires current ownership, deployment, caller ID and explicit direction', async () => {
  const { trunk, config, deployment, did } = carrierFixture();
  const resolve = (trunks = [trunk], deployments = [deployment]) => resolveCarrierOutbound(config, 'primary', did, trunks, deployments);
  assert.equal((await resolve())?.gateway, carrierGateway(trunk));
  await assert.rejects(resolve([trunk], []), /not been deployed/);
  await assert.rejects(resolve([{ ...trunk, revision: 2 }]), /current trunk numbers/);
  await assert.rejects(resolve([{ ...trunk, outboundEnabled: false }]), /disabled/);
  await assert.rejects(resolve([{ ...trunk, organizationId: 'other' }]), /current trunk/);
  await assert.rejects(resolveCarrierOutbound(config, 'other', did, [trunk], [deployment]), /not assigned/);
  config.numberAssignments[did].disabled = true;
  await assert.rejects(resolve(), /not assigned/);
});

test('national inbound aliases are scoped to carrier source and never select an unassigned DID', () => {
  const { trunk, config, deployment, did } = carrierFixture();
  assert.equal(resolveInboundNumber(config, '0135110000', trunk.server, [deployment]), did);
  assert.equal(resolveInboundNumber(config, did, trunk.server, [deployment]), did);
  assert.equal(resolveInboundNumber(config, did, '192.0.2.21', [deployment]), '');
  assert.equal(resolveInboundNumber(config, did, trunk.server, [{ ...deployment, organizationId: 'other' }]), '');
  delete config.numberAssignments[did].destinationType;
  assert.equal(resolveInboundNumber(config, did, trunk.server, [deployment]), '');
});

test('operator gateway artifacts bind the real public IP and cannot activate a form or smuggle XML', () => {
  const { trunk, deployment } = carrierFixture();
  assert.equal(carrierReadiness(trunk, []).status, 'pending_activation');
  assert.equal(carrierReadiness(trunk, [deployment]).status, 'ready');
  assert.equal(carrierReadiness({ ...trunk, revision: 2, connectionRevision: 1 }, [deployment]).status, 'ready', 'destination-only edits keep the connection');
  assert.throws(() => renderCarrierGateway(trunk, '', '198.51.100.11', [trunk.server]), /does not match/);
  assert.throws(() => renderCarrierGateway(trunk, '', trunk.publicIp, ['0.0.0.0/0']), /Exact carrier/);
  const registration = { ...trunk, authentication: 'registration' as const, username: 'sip-user' };
  assert.throws(() => renderCarrierGateway(registration, '', trunk.publicIp, [trunk.server]), /missing/);
  const artifact = renderCarrierGateway(registration, 'abc&<>"123', trunk.publicIp, [trunk.server]);
  assert.match(artifact.xml, /abc&amp;&lt;&gt;&quot;123/);
  assert.throws(() => renderCarrierGateway(registration, '${system bad}', trunk.publicIp, [trunk.server]), /expansion/);
  assert.deepEqual(carrierDeployments(JSON.stringify([deployment])), [deployment]);
  assert.throws(() => carrierDeployments(JSON.stringify([{ ...deployment, gateway: 'telnyx' }])));
  assert.throws(() => carrierDeployments(JSON.stringify([deployment, deployment])));
});
