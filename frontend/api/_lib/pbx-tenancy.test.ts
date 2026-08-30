import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig, organizationSettingsFrom, pbxForOrganization } from './pbx-config-store.js';

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

test('does not treat a hardcoded primary id as the shared workspace owner', () => {
  const config = defaultPbxConfig();
  config.ai.enabled = true;
  config.ai.assistantId = 'asst_active';
  config.activeOrganizationId = 'second-company';
  config.organizations.push({
    id: 'second-company', name: 'Second Company', slug: 'second-company', accountType: 'business',
    ownerDisplayName: 'Second Company', ownerEmail: 'owner@example.com', extensionStart: 3000,
    extensionEnd: 3019, internalCallingEnabled: true, status: 'active',
  });
  const isolatedPrimary = pbxForOrganization(config, 'primary');
  assert.equal(isolatedPrimary.ai.assistantId, '');
  assert.equal(isolatedPrimary.ai.enabled, false);
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
