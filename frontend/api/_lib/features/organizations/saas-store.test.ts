import test from 'node:test';
import assert from 'node:assert/strict';
import { businessOnlyFeatures, createSubscription, defaultPlans, defaultSaasState, effectiveEntitlements } from './saas-store.js';

test('business plan exposes business features but keeps platform API gated', () => {
  const state = defaultSaasState();
  state.subscriptions.primary = createSubscription('primary', 'business', { ...state, plans: defaultPlans() });
  const access = effectiveEntitlements(state, 'primary', 'business');
  assert.equal(access.features.internalCalling, true);
  assert.equal(access.features.aiReceptionist, true);
  assert.equal(access.features.developerApi, false);
});

test('superadmin feature override can enable or disable a company capability', () => {
  const state = defaultSaasState();
  state.subscriptions.primary = createSubscription('primary', 'business', state);
  state.featureOverrides.primary = { aiReceptionist: false, developerApi: true };
  const access = effectiveEntitlements(state, 'primary', 'business');
  assert.equal(access.features.aiReceptionist, false);
  assert.equal(access.features.developerApi, true);
});

test('inactive subscriptions disable every customer feature', () => {
  const state = defaultSaasState();
  state.subscriptions.primary = { ...createSubscription('primary', 'enterprise', state), status: 'past_due' };
  const access = effectiveEntitlements(state, 'primary', 'business');
  assert.equal(access.serviceActive, false);
  assert.equal(Object.values(access.features).some(Boolean), false);
});

test('individual accounts never receive company extension calling', () => {
  const state = defaultSaasState();
  state.subscriptions.person = createSubscription('person', 'enterprise', state);
  state.featureOverrides.person = Object.fromEntries(businessOnlyFeatures.map((key) => [key, true]));
  const access = effectiveEntitlements(state, 'person', 'individual');
  assert.equal(access.features.outboundCalling, true);
  assert.equal(access.features.internalCalling, false);
  for (const feature of businessOnlyFeatures) assert.equal(access.features[feature], false, feature);
  assert.equal(access.features.sms, true);
  assert.equal(access.features.phoneNumbers, true);
});

test('feature overrides cannot bypass a suspended subscription', () => {
  const state = defaultSaasState();
  state.subscriptions.primary = { ...createSubscription('primary', 'starter', state), status: 'suspended' };
  state.featureOverrides.primary = { developerApi: true, outboundCalling: true };
  const access = effectiveEntitlements(state, 'primary', 'business');
  assert.equal(access.features.developerApi, false);
  assert.equal(access.features.outboundCalling, false);
});
