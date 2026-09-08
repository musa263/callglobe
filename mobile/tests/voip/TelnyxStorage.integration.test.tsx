jest.mock('@telnyx/react-voice-commons-sdk', () => ({ createTelnyxVoipClient: jest.fn(() => ({})), VoicePnBridge: {} }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-device-only',
  setItemAsync: jest.fn(async () => undefined), getItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { multiRemove: jest.fn(async () => undefined) },
}));

import * as SecureStore from 'expo-secure-store';
import { loadVoiceSession, persistVoiceSession } from '../../src/features/calling/runtime/voipClient';

test('persisted Telnyx session remains device-only and is available after the phone locks', async () => {
  const session = { token: 'fixture', expiresAt: Date.now() + 60000, iceServers: [] };
  await persistVoiceSession(session);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('vocivo.secure.voice-session.v1', JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(session));
  expect(await loadVoiceSession()).toEqual({ ...session, iceServers: undefined });
});
