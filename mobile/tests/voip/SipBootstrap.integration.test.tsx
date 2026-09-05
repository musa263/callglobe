jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'ios' }, NativeEventEmitter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-unlock-device-only',
}));
jest.mock('../../src/shared/api', () => ({ api: { getSessionToken: jest.fn(), post: jest.fn() } }));
jest.mock('../../src/features/calling/engine/sipStackSipJs', () => ({ createSipJsStack: jest.fn() }));

import * as SecureStore from 'expo-secure-store';
import { api } from '../../src/shared/api';
import { createSipJsStack } from '../../src/features/calling/engine/sipStackSipJs';
import { createSipVoiceClient, disposeSipVoiceClient, ensureSipRegistration, unregisterVocivoSip } from '../../src/features/calling/runtime/sipNative';

const config = { username: 'employee-a', password: 'temporary', domain: 'sip.example', wsUri: 'wss://sip.example/ws', iceServers: [{ urls: 'turns:relay.example', username: 'ephemeral', credential: 'test' }] };
const response = { ...config, expires_in: 3600, ice_servers: config.iceServers };
let stack: { start: jest.Mock; stop: jest.Mock; refresh: jest.Mock; onRegistrationChange: jest.Mock; onInvitation: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  stack = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), refresh: jest.fn(async () => undefined), onRegistrationChange: jest.fn(), onInvitation: jest.fn() };
  (api.getSessionToken as jest.Mock).mockResolvedValue('signed-session-a');
  (api.post as jest.Mock).mockResolvedValue(response);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (createSipJsStack as jest.Mock).mockResolvedValue(stack);
});

afterEach(async () => { await unregisterVocivoSip(); disposeSipVoiceClient(); });

test('a killed-state bootstrap can register directly from a fresh secure cache with TURN intact', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({ sessionToken: 'signed-session-a', config, expiresAt: Date.now() + 3600_000 }));
  await ensureSipRegistration();
  expect(api.post).not.toHaveBeenCalled();
  expect(createSipJsStack).toHaveBeenCalledWith(expect.objectContaining(config), expect.anything());
  expect(stack.start).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), expect.any(String), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
});

test.each([Date.now() - 1, Date.now() + 10_000, null])('expired or invalid cache %s is refreshed before connecting', async (expiresAt) => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({ sessionToken: 'signed-session-a', config, expiresAt }));
  await ensureSipRegistration();
  expect(api.post).toHaveBeenCalledWith('/api/voice/sip-credentials', { client: 'mobile' });
  expect(stack.start).toHaveBeenCalledTimes(1);
});

test('a cache from another signed-in session is never reused', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({ sessionToken: 'other-session', config, expiresAt: Date.now() + 3600_000 }));
  await ensureSipRegistration();
  expect(api.post).toHaveBeenCalledTimes(1);
});

test('foreground and push boot share one in-flight registration', async () => {
  const first = ensureSipRegistration(); const second = ensureSipRegistration();
  expect(first).toBe(second); await first;
  expect(stack.start).toHaveBeenCalledTimes(1);
});

test('logout invalidates a pending bootstrap before it can open a signaling socket', async () => {
  const client = createSipVoiceClient();
  let finish!: (value: typeof response) => void;
  (api.post as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const boot = ensureSipRegistration();
  const failure = expect(boot).rejects.toThrow('Calling session changed');
  while (!finish) await Promise.resolve();
  const logout = client.logout();
  finish(response); await failure; await logout;
  expect(stack.start).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
