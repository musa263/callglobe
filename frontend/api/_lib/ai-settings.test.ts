import assert from 'node:assert/strict';
import test from 'node:test';
import { aiSettingsFromRequest, nextAiSettings } from './ai-settings.js';

const current = {
  enabled: false, assistantId: 'assistant_ours', name: 'Reception', greeting: 'Thanks for calling.',
  instructions: 'Be brief.', knowledge: '', voice: 'Vocivo.Kokoro.Heart', language: 'en',
  fallbackExtension: '2000', transferEnabled: false, summariesEnabled: false,
};

test('keeps the tenant edits and nothing else', () => {
  const saved = nextAiSettings(current, {
    name: '  Front Desk  ', greeting: 'Good morning.', enabled: true, transferEnabled: true, fallbackExtension: '2001',
  });
  assert.equal(saved.name, 'Front Desk');
  assert.equal(saved.greeting, 'Good morning.');
  assert.equal(saved.enabled, true);
  assert.equal(saved.transferEnabled, true);
  assert.equal(saved.fallbackExtension, '2001');
  assert.equal(saved.instructions, 'Be brief.', 'a field the request did not name is unchanged');
});

test('the carrier assistant id is not the caller’s to set', () => {
  // Sending another tenant's id used to have their assistant rewritten with
  // this tenant's name, instructions and voice.
  const saved = nextAiSettings(current, { assistantId: 'assistant_belonging_to_someone_else', name: 'Reception' });
  assert.equal(saved.assistantId, 'assistant_ours');
});

test('ignores anything the settings do not include', () => {
  const picked = aiSettingsFromRequest({ name: 'Reception', organizationId: 'other', __proto__: { polluted: true }, extra: 'x' });
  assert.deepEqual(Object.keys(picked), ['name']);
});

test('a string field is only taken when it is a string, and a flag only when it is a boolean', () => {
  const picked = aiSettingsFromRequest({ name: 42, enabled: 'yes', greeting: null, summariesEnabled: true });
  assert.deepEqual(picked, { summariesEnabled: true });
});

test('caps the brief and the knowledge base so one tenant cannot fill the configuration', () => {
  const saved = nextAiSettings(current, { instructions: 'i'.repeat(20_000), knowledge: 'k'.repeat(50_000) });
  assert.equal(saved.instructions.length, 8000);
  assert.equal(saved.knowledge.length, 24_000);
});
