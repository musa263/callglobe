import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionUser } from './pbx.js';
import { defaultPbxConfig, type PbxConfig } from './pbx-config-store.js';
import { parseConversation, receptionistFor, receptionistVoice, transferTargets } from './receptionist.js';

function extension(overrides: Partial<ExtensionUser> = {}): ExtensionUser {
  return {
    id: 'u1',
    extension: '1001',
    name: 'Sam Tailor',
    email: 'sam@example.com',
    mobile: '',
    organizationId: 'org-1',
    department: '',
    role: 'user',
    sipUsername: 'sam-1001',
    status: 'active',
    ...overrides,
  };
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    numberAssignments: { '+18447161777': { organizationId: 'org-1' } },
    organizationSettings: {},
    officeHours: defaultPbxConfig().officeHours,
    ai: {
      enabled: true,
      assistantId: '',
      name: 'Reception',
      greeting: 'Thanks for calling.',
      instructions: 'Be brief.',
      knowledge: 'We close at five.',
      voice: 'Telnyx.Bayan.Amanda',
      language: 'en',
      fallbackExtension: '1001',
      transferEnabled: true,
      summariesEnabled: true,
    },
    ...overrides,
  } as unknown as PbxConfig;
}

function inputFor(base: PbxConfig, extensions: ExtensionUser[] = [extension()]) {
  return {
    number: '+1 844 716 1777',
    config: base,
    tenantFor: () => base,
    extensionsFor: async () => extensions,
  };
}

test('a carrier voice name maps onto the self-hosted voice nearest it', () => {
  assert.equal(receptionistVoice('Telnyx.Bayan.Amanda'), 'af_heart');
  assert.equal(receptionistVoice('Telnyx.Bayan.Adam'), 'am_adam');
  // Already self-hosted, or unrecognised: never left as a carrier name the
  // speech engine would refuse, which would leave the receptionist silent.
  assert.equal(receptionistVoice('am_michael'), 'am_michael');
  assert.equal(receptionistVoice('something.else'), 'af_heart');
  assert.equal(receptionistVoice(''), 'af_heart');
});

test('the voice a tenant picks in the admin is the voice the receptionist speaks with', () => {
  // The admin offers the catalog ids; the receptionist knew four engine ids
  // and quietly spoke with the default for every other choice.
  assert.equal(receptionistVoice('Vocivo.Kokoro.AmAdam'), 'am_adam');
  assert.equal(receptionistVoice('Vocivo.Kokoro.BfEmma'), 'bf_emma');
  assert.equal(receptionistVoice('Vocivo.Kokoro.EfDora'), 'ef_dora');
  assert.equal(receptionistVoice('Telnyx.KokoroTTS.bm_george'), 'bm_george');
  assert.equal(receptionistVoice('bf_lily'), 'bf_lily');
});

test('only extensions somebody can actually answer are offered as transfers', () => {
  const targets = transferTargets([
    extension(),
    extension({ id: 'u2', extension: '1002', name: '', email: 'accounts@example.com', sipUsername: 'acc-1002' }),
    extension({ id: 'u3', extension: '1003', status: 'expired' }),
    extension({ id: 'u4', extension: '1004', sipUsername: '' }),
  ]);
  assert.deepEqual(targets, [
    { extension: '1001', label: 'Sam Tailor' },
    { extension: '1002', label: 'accounts@example.com' },
  ]);
});

test('the dialled number resolves to its tenant’s receptionist', async () => {
  const profile = await receptionistFor(inputFor(config()));
  assert.ok(profile);
  assert.equal(profile.organizationId, 'org-1');
  assert.equal(profile.voice, 'af_heart');
  assert.equal(profile.greeting, 'Thanks for calling.');
  // The knowledge base is part of the brief rather than a separate lookup.
  assert.equal(profile.instructions, 'Be brief.\n\nWe close at five.');
  assert.deepEqual(profile.targets, [{ extension: '1001', label: 'Sam Tailor' }]);
  assert.equal(profile.fallbackExtension, '1001');
});

test('a number nobody owns has no receptionist', async () => {
  const profile = await receptionistFor({ ...inputFor(config()), number: '+15550001111' });
  assert.equal(profile, null);
});

test('a tenant with the receptionist switched off gets none', async () => {
  const base = config();
  (base as unknown as { ai: { enabled: boolean } }).ai.enabled = false;
  assert.equal(await receptionistFor(inputFor(base)), null);
});

test('transfers are reported as unavailable when there is nowhere to transfer', async () => {
  const profile = await receptionistFor(inputFor(config(), [extension({ status: 'expired' })]));
  assert.ok(profile);
  assert.equal(profile.transferEnabled, false);
  assert.deepEqual(profile.targets, []);
  // A fallback that is not reachable must not be handed to the receptionist,
  // or a caller is told they are being put through to nobody.
  assert.equal(profile.fallbackExtension, '');
});

test('a fallback extension that is not a live target is dropped', async () => {
  const base = config();
  (base as unknown as { ai: { fallbackExtension: string } }).ai.fallbackExtension = '2000';
  const profile = await receptionistFor(inputFor(base));
  assert.ok(profile);
  assert.equal(profile.fallbackExtension, '');
  assert.equal(profile.transferEnabled, true);
});

test('a finished call is normalised before it is stored', () => {
  const conversation = parseConversation({
    callId: 'abc-123',
    number: '+1 844 716 1777',
    caller: '+15551230000',
    outcome: 'transferred',
    transferredTo: '1001',
    seconds: 42.37,
    transcript: 'Reception: Hello.\nCaller: Hi.',
    note: 'Put through to Sam.',
  });
  assert.ok(conversation);
  assert.equal(conversation.outcome, 'transferred');
  assert.equal(conversation.seconds, 42.4);
  assert.equal(conversation.number, '+18447161777');
});

test('a number without a country code is left alone rather than guessed at', () => {
  // The edge always sends E.164 — the dialplan sets vocivo_did with a leading
  // plus — so anything else is a caller-supplied oddity, not a US number.
  const conversation = parseConversation({ callId: 'abc', number: '844 716 1777' });
  assert.ok(conversation);
  assert.equal(conversation.number, '8447161777');
});

test('an unknown outcome is recorded as an error rather than trusted', () => {
  const conversation = parseConversation({ callId: 'abc', outcome: 'went_great' });
  assert.ok(conversation);
  assert.equal(conversation.outcome, 'error');
});

test('a report without a call id is refused', () => {
  assert.equal(parseConversation({ outcome: 'completed' }), null);
  assert.equal(parseConversation(null), null);
  assert.equal(parseConversation('a call happened'), null);
});

test('a transcript is bounded, because a caller can talk for a long time', () => {
  const conversation = parseConversation({ callId: 'abc', transcript: 'x'.repeat(50_000) });
  assert.ok(conversation);
  assert.equal(conversation.transcript.length, 20_000);
});

test('after hours the receptionist still answers, but takes messages instead of transferring', async () => {
  const base = config();
  const closed = { ...base, officeHours: { ...base.officeHours, weekdays: Object.fromEntries(Object.keys(base.officeHours.weekdays).map((day) => [day, { enabled: false, start: '09:00', end: '17:00' }])) } } as PbxConfig;
  const profile = await receptionistFor({ ...inputFor(closed), tenantFor: () => closed });
  assert.ok(profile, 'a closed office is exactly when a receptionist is needed');
  assert.equal(profile!.officeOpen, false);
  assert.equal(profile!.transferEnabled, false, 'nobody is at their desk to transfer to');
  assert.deepEqual(profile!.targets, []);
  assert.equal(profile!.fallbackExtension, '');

  const open = await receptionistFor(inputFor(base));
  assert.equal(open!.officeOpen, true);
  assert.equal(open!.transferEnabled, true);
});
