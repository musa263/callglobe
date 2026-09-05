import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig, legacyPrimaryOrganizationId, organizationSettingsFrom, pbxForOrganization } from './pbx-config-store.js';

test('keeps company PBX routing and AI settings isolated', () => {
  const config = defaultPbxConfig();
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  const second = structuredClone(config);
  second.company.name = 'Second Company';
  second.officeHours.timezone = 'Europe/London';
  second.ai.name = 'Second Company Receptionist';
  second.callHandling.ringGroups = [{ id: 'support', name: 'Support', extension: '3100', strategy: 'Ring all', members: ['user-2'], timeout: 25, fallback: 'Main voicemail' }];
  config.organizationSettings['second-company'] = organizationSettingsFrom(second);

  const primary = pbxForOrganization(config, 'primary');
  const tenant = pbxForOrganization(config, 'second-company');
  assert.equal(primary.company.name, 'Global Heritage');
  assert.equal(primary.officeHours.timezone, 'Asia/Riyadh');
  assert.equal(primary.callHandling.ringGroups.length, 0);
  assert.equal(tenant.company.name, 'Second Company');
  assert.equal(tenant.officeHours.timezone, 'Europe/London');
  assert.equal(tenant.ai.name, 'Second Company Receptionist');
  assert.equal(tenant.callHandling.ringGroups[0]?.name, 'Support');
});

test('the settings that predate multi-tenancy belong to the first organization, not to a hardcoded id', () => {
  const config = defaultPbxConfig();
  config.ai.enabled = true;
  config.ai.assistantId = 'asst_active';
  config.organizations[0] = { ...config.organizations[0], id: 'legacy-co', slug: 'legacy-co' };
  config.activeOrganizationId = 'legacy-co';
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  assert.equal(pbxForOrganization(config, 'legacy-co').ai.assistantId, 'asst_active');
  assert.equal(pbxForOrganization(config, 'primary').ai.assistantId, '', 'no id is the owner by name');
  assert.equal(pbxForOrganization(config, 'primary').ai.enabled, false);
});

test('a superadmin opening another customer does not hand them the legacy receptionist', () => {
  // Opening a customer saves it as the active organization, and ownership of
  // the shared settings used to follow that: the legacy tenant's voice menu,
  // office hours and AI receptionist moved to whichever customer was last
  // looked at, and answered their calls in the other company's voice.
  const config = defaultPbxConfig();
  config.ai.enabled = true;
  config.ai.assistantId = 'asst_legacy';
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  config.activeOrganizationId = 'second-company';
  assert.equal(pbxForOrganization(config, 'second-company').ai.assistantId, '');
  assert.equal(pbxForOrganization(config, 'second-company').ai.enabled, false);
  assert.equal(pbxForOrganization(config, 'primary').ai.assistantId, 'asst_legacy', 'the legacy tenant keeps its own');
});

test('an explicit pin decides which organization owns the legacy settings', () => {
  const config = defaultPbxConfig();
  config.ai.assistantId = 'asst_legacy';
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  config.legacyPrimaryOrganizationId = 'second-company';
  assert.equal(legacyPrimaryOrganizationId(config), 'second-company');
  assert.equal(pbxForOrganization(config, 'second-company').ai.assistantId, 'asst_legacy');
  assert.equal(pbxForOrganization(config, 'primary').ai.assistantId, '');
  config.legacyPrimaryOrganizationId = 'no-such-organization';
  assert.equal(legacyPrimaryOrganizationId(config), 'primary', 'a pin at nothing falls back to the first organization');
});

test('does not let a new tenant inherit the primary AI receptionist', () => {
  const config = defaultPbxConfig();
  config.ai.enabled = true;
  config.ai.assistantId = 'asst_primary';
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  const tenant = pbxForOrganization(config, 'second-company');
  assert.equal(tenant.ai.enabled, false);
  assert.equal(tenant.ai.assistantId, '');
  assert.equal(pbxForOrganization(config, 'primary').ai.assistantId, 'asst_primary');
});
