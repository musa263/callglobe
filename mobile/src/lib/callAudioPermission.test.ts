import assert from 'node:assert/strict';
import test from 'node:test';
import { deniedMicrophoneMessage, ensureCallMicrophonePermission } from './callAudioPermission';

test('does not prompt when the microphone is already allowed', async () => {
  let requested = 0;
  await ensureCallMicrophonePermission({
    getRecordingPermissionsAsync: async () => ({ granted: true }),
    requestRecordingPermissionsAsync: async () => {
      requested += 1;
      return { granted: true };
    },
  });
  assert.equal(requested, 0);
});

test('prompts before a call when iOS has not granted the microphone yet', async () => {
  let requested = 0;
  await ensureCallMicrophonePermission({
    getRecordingPermissionsAsync: async () => ({ granted: false }),
    requestRecordingPermissionsAsync: async () => {
      requested += 1;
      return { granted: true };
    },
  });
  assert.equal(requested, 1);
});

test('refuses to start a call when the microphone is denied', async () => {
  await assert.rejects(
    ensureCallMicrophonePermission({
      getRecordingPermissionsAsync: async () => ({ granted: false }),
      requestRecordingPermissionsAsync: async () => ({ granted: false }),
    }),
    { message: deniedMicrophoneMessage() },
  );
});
