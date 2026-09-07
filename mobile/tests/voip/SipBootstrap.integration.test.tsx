jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'ios' }, NativeEventEmitter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-unlock-device-only',
}));
jest.mock('../../src/shared/api', () => ({ api: { getSessionToken: jest.fn(), post: jest.fn(), delete: jest.fn(async () => ({})) } }));
jest.mock('../../src/features/calling/engine/sipStackSipJs', () => ({ createSipJsStack: jest.fn() }));

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from '../../src/shared/api';
import { createSipJsStack } from '../../src/features/calling/engine/sipStackSipJs';
import { createSipVoiceClient, disposeSipVoiceClient, ensureSipRegistration, unregisterVocivoSip } from '../../src/features/calling/runtime/sipNative';

const config = { username: 'employee-a', password: 'temporary', domain: 'sip.example', wsUri: 'wss://sip.example/ws', iceServers: [{ urls: 'turns:relay.example', username: 'ephemeral', credential: 'test' }] };
const device = { deviceId: 'iphone-installation-1234', credentialId: 'credential-generation-5678' };
const response = { ...config, ...device, expires_in: 3600, ice_servers: config.iceServers };
const secureValues = new Map<string, string>();
function cache(value: object) { secureValues.set('vocivo.secure.sip-session.v1', JSON.stringify({ ...device, ...value })); }
let stack: { start: jest.Mock; stop: jest.Mock; refresh: jest.Mock; onRegistrationChange: jest.Mock; onInvitation: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'ios';
  stack = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), refresh: jest.fn(async () => undefined), onRegistrationChange: jest.fn(), onInvitation: jest.fn() };
  (api.getSessionToken as jest.Mock).mockResolvedValue('signed-session-a');
  (api.post as jest.Mock).mockResolvedValue(response);
  secureValues.clear();
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async key => secureValues.get(key) || null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key, value) => { secureValues.set(key, value); });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async key => { secureValues.delete(key); });
  (createSipJsStack as jest.Mock).mockResolvedValue(stack);
});

afterEach(async () => { await unregisterVocivoSip(); disposeSipVoiceClient(); });

test('a killed-state bootstrap can register directly from a fresh secure cache with TURN intact', async () => {
  cache({ sessionToken: 'signed-session-a', config, expiresAt: Date.now() + 3600_000 });
  await ensureSipRegistration();
  expect(api.post).not.toHaveBeenCalled();
  expect(createSipJsStack).toHaveBeenCalledWith(expect.objectContaining(config), expect.anything());
  expect(stack.start).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), expect.any(String), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
});

test.each([Date.now() - 1, Date.now() + 10_000, null])('expired or invalid cache %s is refreshed before connecting', async (expiresAt) => {
  cache({ sessionToken: 'signed-session-a', config, expiresAt });
  await ensureSipRegistration();
  expect(api.post).toHaveBeenCalledWith('/api/voice/sip-credentials', { client: 'ios' });
  expect(stack.start).toHaveBeenCalledTimes(1);
});

test('a cache from another signed-in session is never reused', async () => {
  cache({ sessionToken: 'other-session', config, expiresAt: Date.now() + 3600_000 });
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
  expect(api.delete).toHaveBeenCalledWith(expect.stringContaining(`credentialId=${device.credentialId}`));
});

test.each(['ios', 'android'])('%s registration persists its installation identity across rotations and logout', async (platform) => {
  (Platform as { OS: string }).OS = platform;
  await ensureSipRegistration();
  expect(secureValues.get('vocivo.secure.sip-device.v1')).toBe(device.deviceId);
  await ensureSipRegistration(true);
  expect(api.post).toHaveBeenLastCalledWith('/api/voice/sip-credentials', { client: platform, deviceId: device.deviceId });
  await unregisterVocivoSip();
  expect(api.delete).toHaveBeenCalledWith(`/api/voice/sip-credentials?deviceId=${device.deviceId}&credentialId=${device.credentialId}`);
  expect(secureValues.has('vocivo.secure.sip-session.v1')).toBe(false);
  expect(secureValues.get('vocivo.secure.sip-device.v1')).toBe(device.deviceId);
});

test('an old week-long SIP cache with expired TURN is renewed before bootstrap', async () => {
  const expiredIce = [{ urls: 'turn:relay.example:3478', username: `${Math.floor(Date.now() / 1000) - 1}:employee`, credential: 'old-turn' }];
  cache({ sessionToken: 'signed-session-a', config: { ...config, iceServers: expiredIce }, expiresAt: Date.now() + 7 * 86400_000 });
  await ensureSipRegistration();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(createSipJsStack).toHaveBeenCalledWith(expect.objectContaining({ iceServers: config.iceServers }), expect.anything());
});

test('cached TURN expiry bounds the next scheduled configuration refresh', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 120;
  const iceServers = [{ urls: 'turn:relay.example:3478', username: `${expiry}:employee`, credential: 'turn' }];
  cache({ sessionToken: 'signed-session-a', config: { ...config, iceServers }, expiresAt: Date.now() + 7 * 86400_000 });
  const lifetime = await ensureSipRegistration();
  expect(api.post).not.toHaveBeenCalled();
  expect(lifetime).toBeLessThanOrEqual(120);
  expect(lifetime).toBeGreaterThan(100);
});
