import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeOutboundCall } from './outbound-policy.js';
import { defaultPbxConfig } from './pbx-config-store.js';

// assertOrganizationMayCall itself reads the subscription and the wallet, which
// are stores rather than arguments. What is worth pinning here is the rule that
// decides whether a key — which is not an extension — has a route at all.

function configWith(rules: Array<Partial<ReturnType<typeof defaultPbxConfig>['outboundRules'][number]>>) {
  const config = defaultPbxConfig();
  config.outboundRules = rules.map((rule, index) => ({
    id: `rule-${index}`, name: `Rule ${index}`, prefix: '', extensionRange: '', numberLength: '',
    department: '', routes: ['primary'], enabled: true, ...rule,
  }));
  return config;
}

const apiKeyActor = { internationalAllowed: true };

test('a rule that applies to every extension applies to an API key too', () => {
  const config = configWith([{}]);
  assert.equal(authorizeOutboundCall(config, apiKeyActor, '+2348000000000', '+18447161777').id, 'rule-0');
});

test('a rule scoped to an extension range is not an API key’s rule', () => {
  // The key acts for the company, not for a person at a desk. Refusing is the
  // honest answer, and it says what to add.
  const config = configWith([{ extensionRange: '2000-2019' }]);
  assert.throws(() => authorizeOutboundCall(config, apiKeyActor, '+2348000000000', '+18447161777'), /outbound rule/i);
});

test('a company with no enabled rule at all cannot place the call', () => {
  assert.throws(() => authorizeOutboundCall(configWith([{ enabled: false }]), apiKeyActor, '+2348000000000', '+18447161777'), /outbound rule/i);
  assert.throws(() => authorizeOutboundCall(configWith([]), apiKeyActor, '+2348000000000', '+18447161777'), /outbound rule/i);
});

test('prefix and length rules still decide the destination', () => {
  const config = configWith([{ prefix: '+234' }]);
  assert.equal(authorizeOutboundCall(config, apiKeyActor, '+2348000000000', '+18447161777').id, 'rule-0');
  assert.throws(() => authorizeOutboundCall(config, apiKeyActor, '+18005550100', '+18447161777'), /outbound rule/i);
});
