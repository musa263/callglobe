import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { planSipInbound, planSipInboundDigit, sanitizePrompt } from './sip-inbound-plan.js';

test('Vocivo SIP IVR and AI run on the edge instead of Call Control', () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.callHandling.ivrs = [{
    id: 'main-menu',
    name: 'Main',
    extension: '8000',
    greeting: 'Welcome to the company.',
    options: { '1': 'extension:user-1', '2': 'ring_group:sales' },
  }];
  config.callHandling.ringGroups = [{ id: 'sales', name: 'Sales', extension: '3100', strategy: 'Ring all', members: ['user-2'], timeout: 25, fallback: 'Main voicemail' }];
  config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'sip_trunk', destinationType: 'ivr', destinationId: 'main-menu' };
  const plan = planSipInbound('+15551212', config);
  assert.equal(plan.enabled, true);
  assert.equal(plan.action, 'ivr');
  assert.equal(plan.wallet.charged, false);
  assert.equal(plan.digits, '12');
  assert.match(plan.prompt, /Welcome to the company/);
  const pressed = planSipInboundDigit('+15551212', '2', config);
  assert.equal(pressed.action, 'bridge');
  assert.equal(pressed.handlingId, 'sales');
});

test('main-line AI receptionist is a Vocivo prompt and transfer, not Telnyx Assistants', () => {
  const config = defaultPbxConfig();
  config.ai.enabled = true;
  config.ai.greeting = 'Hi, this is the receptionist.';
  config.ai.fallbackExtension = '2000';
  config.numberAssignments['+15559876'] = { organizationId: 'primary', source: 'sip_trunk', destinationType: 'main' };
  const plan = planSipInbound('+15559876', config);
  assert.equal(plan.action, 'ai');
  assert.equal(planSipInboundDigit('+15559876', '1', config).action, 'bridge');
});

test('Telnyx-owned numbers stay off the SIP edge until the inbound flag is set', () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'owned', destinationType: 'ivr', destinationId: 'menu' };
  const plan = planSipInbound('+15551212', config);
  assert.equal(plan.enabled, false);
  assert.equal(plan.reason, 'call_control_features');
});

test('prompt text is safe for FreeSWITCH JSON channel vars', () => {
  assert.equal(sanitizePrompt('Hello, "world"!\nPress 1.'), 'Hello, world! Press 1.');
});
