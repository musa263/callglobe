import assert from 'node:assert/strict';
import test from 'node:test';
import { activeAiTransferTargets, aiAssistantInstructions, aiAssistantTools, inboundAiCommandId, inboundAiRoutingKey } from './ai-transfer.js';
import { defaultPbxConfig } from './pbx-config-store.js';
import type { ExtensionUser } from './pbx.js';

const extension = (value: Partial<ExtensionUser> & Pick<ExtensionUser, 'id' | 'extension' | 'name' | 'organizationId' | 'sipUsername'>): ExtensionUser => ({
  email: '', mobile: '', department: 'General', role: 'user', status: 'active', ...value,
});

test('AI transfer directory exposes every active extension in the requested tenant', () => {
  const config = defaultPbxConfig();
  const targets = activeAiTransferTargets(config, 'primary', [
    extension({ id: '2', extension: '2001', name: 'Othman Uthman', organizationId: 'primary', sipUsername: 'othman' }),
    extension({ id: '1', extension: '2000', name: 'Mousa Usman', organizationId: 'primary', sipUsername: 'mousa' }),
    extension({ id: '3', extension: '2002', name: 'Expired User', organizationId: 'primary', sipUsername: 'expired', status: 'expired' }),
    extension({ id: '4', extension: '2003', name: 'Other Tenant', organizationId: 'other', sipUsername: 'other' }),
  ]);
  assert.deepEqual(targets, [
    { name: 'Mousa Usman, extension 2000', to: 'sip:mousa@sip.telnyx.com' },
    { name: 'Othman Uthman, extension 2001', to: 'sip:othman@sip.telnyx.com' },
  ]);
});

test('AI instructions permit any directory extension and reserve 2000 as fallback', () => {
  const ai = defaultPbxConfig().ai;
  const instructions = aiAssistantInstructions(ai, [
    { name: 'Mousa Usman, extension 2000', to: 'sip:mousa@sip.telnyx.com' },
    { name: 'Othman Uthman, extension 2001', to: 'sip:othman@sip.telnyx.com' },
  ]);
  assert.match(instructions, /any active colleague or extension/i);
  assert.match(instructions, /Othman Uthman, extension 2001/);
  assert.match(instructions, /Use extension 2000 only when/i);
  assert.match(instructions, /Never claim that transfers are limited/i);
});

test('AI transfer tool includes all tenant targets and requires a voice caller ID', () => {
  const targets = [{ name: 'Othman Uthman, extension 2001', to: 'sip:othman@sip.telnyx.com' }];
  assert.deepEqual(aiAssistantTools(true, targets, '+18447161777')[0], {
    type: 'transfer', transfer: { targets, from: '+18447161777' },
  });
  assert.throws(() => aiAssistantTools(true, targets, 'not-a-number'), /E\.164/);
});

test('AI routing identifiers are stable per call and distinct across calls', () => {
  assert.equal(inboundAiRoutingKey('call-a'), inboundAiRoutingKey('call-a'));
  assert.notEqual(inboundAiRoutingKey('call-a'), inboundAiRoutingKey('call-b'));
  assert.equal(inboundAiCommandId('call-a'), inboundAiCommandId('call-a'));
  assert.notEqual(inboundAiCommandId('call-a'), inboundAiCommandId('call-b'));
});
