import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  NativeModules: { VocivoSip: {} },
  Platform: { OS: 'ios' },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: jest.fn(() => jest.fn()) },
}));
jest.mock('@telnyx/react-voice-commons-sdk', () => ({
  createTokenConfig: jest.fn(),
  TelnyxVoipClient: { isLaunchedFromPushNotification: jest.fn(async () => false) },
}));
jest.mock('../../src/shared/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../src/features/calling/media/ringtone', () => ({
  applyIncomingRingtone: jest.fn(async () => undefined),
  defaultRingtone: 'vocivo_classic',
  loadIncomingRingtone: jest.fn(async () => 'system'),
}));
jest.mock('../../src/features/calling/runtime/voipClient', () => ({
  getVoicePushToken: jest.fn(async () => 'device-token'),
  loadVoiceSession: jest.fn(async () => null),
  persistVoiceSession: jest.fn(async () => undefined),
  voipClient: { loginWithToken: jest.fn() },
}));
jest.mock('../../src/features/calling/runtime/sipNative', () => ({
  unregisterVocivoSip: jest.fn(async () => undefined),
  onSipRegistration: jest.fn(() => ({ remove: jest.fn() })),
  refreshVocivoSip: jest.fn(async () => undefined),
  ensureSipRegistration: jest.fn(async () => 3600),
}));
jest.mock('../../src/features/calling/engine/engines', () => ({
  sipEngine: () => ({ name: 'sip', client: {}, platform: {} }),
  telnyxEngine: () => ({ name: 'telnyx', client: {}, platform: {} }),
}));
jest.mock('../../src/features/calling/engine/voiceClientFacade', () => ({
  voice: { use: jest.fn(), logout: jest.fn(async () => undefined) },
}));

import { TelnyxVoipClient } from '@telnyx/react-voice-commons-sdk';
import { applyIncomingRingtone, loadIncomingRingtone } from '../../src/features/calling/media/ringtone';
import { voice } from '../../src/features/calling/engine/voiceClientFacade';
import { api } from '../../src/shared/api';
import { ensureSipRegistration } from '../../src/features/calling/runtime/sipNative';
import { getVoicePushToken, loadVoiceSession, persistVoiceSession, voipClient } from '../../src/features/calling/runtime/voipClient';
import { useVoiceRegistration } from '../../src/features/calling/engine/useVoiceRegistration';

const iceServers = [{ urls: 'turn:relay.example:3478', username: 'temporary', credential: 'test' }];
const sipCredentials = { username: 'extension-user', password: 'test', domain: 'sip.example', wsUri: 'wss://sip.example', expires_in: 3600, ice_servers: iceServers };
let tree: TestRenderer.ReactTestRenderer | undefined;
let inputs: Parameters<typeof useVoiceRegistration>[0];

function Probe() { useVoiceRegistration(inputs); return null; }

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  jest.clearAllMocks();
  inputs = {
    activeCallRef: { current: null }, loginConfigRef: { current: null },
    isAuthenticated: true, loading: false,
    reportVoiceError: jest.fn(), setError: jest.fn(), setPushRegistration: jest.fn(),
  };
  (api.get as jest.Mock).mockResolvedValue({ voice_edge: 'sip' });
  (api.post as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/api/voice/sip-credentials') return sipCredentials;
    if (path === '/api/voice/devices') return { ok: true };
    throw new Error(`Unexpected endpoint: ${path}`);
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('SIP startup shares the native bootstrap without requesting or persisting a Telnyx session', async () => {
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(ensureSipRegistration).toHaveBeenCalledWith(false);
  expect(api.post).not.toHaveBeenCalledWith('/api/telnyx/token', expect.anything());
  expect(persistVoiceSession).not.toHaveBeenCalled();
  expect(voipClient.loginWithToken).not.toHaveBeenCalled();
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});

test('configuration failure starts neither engine and retries instead of falling back to Telnyx', async () => {
  (api.get as jest.Mock).mockRejectedValue(new Error('offline'));
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(api.post).not.toHaveBeenCalled();
  expect(ensureSipRegistration).not.toHaveBeenCalled();
  expect(inputs.reportVoiceError).toHaveBeenCalledWith('initialize configured voice engine', expect.any(Error));
  (api.get as jest.Mock).mockResolvedValue({ voice_edge: 'sip' });
  await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
});

test('failed push-token persistence is retried before registration is reported successful', async () => {
  (api.post as jest.Mock).mockRejectedValueOnce(new Error('temporary device store outage'));
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('unavailable');
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  const deviceWrites = (api.post as jest.Mock).mock.calls.filter(([path]) => path === '/api/voice/devices');
  expect(deviceWrites).toHaveLength(2);
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}


test('SIP startup does not wait for ringtone storage or push token delivery', async () => {
  const ringtone = deferred<'vocivo_classic'>();
  const push = deferred<string>();
  (loadIncomingRingtone as jest.Mock).mockReturnValueOnce(ringtone.promise);
  (getVoicePushToken as jest.Mock).mockReturnValueOnce(push.promise);
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
  expect(voice.use).toHaveBeenCalledWith('sip', expect.anything(), expect.anything());
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registering');
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
  expect(getVoicePushToken).toHaveBeenCalledTimes(1);
  await act(async () => { ringtone.resolve('vocivo_classic'); push.resolve('device-token'); });
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
});

test('slow native ringtone setup and device persistence do not block SIP', async () => {
  const ringtone = deferred<void>();
  const deviceWrite = deferred<object>();
  (applyIncomingRingtone as jest.Mock).mockReturnValueOnce(ringtone.promise);
  (api.post as jest.Mock).mockReturnValueOnce(deviceWrite.promise);
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registering');
  await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => { ringtone.resolve(); deviceWrite.resolve({ ok: true }); });
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});

test('ringtone and push-token failures do not retry the signaling bootstrap', async () => {
  (applyIncomingRingtone as jest.Mock).mockRejectedValueOnce(new Error('native ringtone unavailable'));
  (getVoicePushToken as jest.Mock).mockRejectedValueOnce(new Error('push unavailable'));
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
  expect(inputs.setError).not.toHaveBeenCalled();
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('unavailable');
  expect(inputs.reportVoiceError).toHaveBeenCalledWith('prepare incoming ringtone', expect.any(Error));
  await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});

test('late carrier bootstrap data does not fetch config or register SIP again', async () => {
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  inputs = { ...inputs, bootstrapSession: { token: 'carrier-token', expiresAt: Date.now() + 3600_000, ringtone: 'vocivo_classic' } };
  await act(async () => { tree!.update(<Probe />); });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(ensureSipRegistration).toHaveBeenCalledTimes(1);
  expect(voipClient.loginWithToken).not.toHaveBeenCalled();
});

test('the managed edge retains its token, persistence and login sequence', async () => {
  (api.get as jest.Mock).mockResolvedValue({ voice_edge: 'telnyx' });
  (api.post as jest.Mock).mockImplementation(async path => path === '/api/telnyx/token'
    ? { token: 'carrier-token', expires_in: 3600, ice_servers: iceServers }
    : { ok: true });
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(ensureSipRegistration).not.toHaveBeenCalled();
  expect(voice.use).toHaveBeenCalledWith('telnyx', expect.anything(), expect.anything());
  expect(persistVoiceSession).toHaveBeenCalledTimes(1);
  expect(voipClient.loginWithToken).toHaveBeenCalledTimes(1);
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});

test('pending auxiliary work cannot write device tokens or update status after cleanup', async () => {
  const ringtone = deferred<'vocivo_classic'>();
  const push = deferred<string>();
  (loadIncomingRingtone as jest.Mock).mockReturnValueOnce(ringtone.promise);
  (getVoicePushToken as jest.Mock).mockReturnValueOnce(push.promise);
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  await act(async () => { tree!.unmount(); });
  tree = undefined;
  (inputs.setPushRegistration as jest.Mock).mockClear();
  await act(async () => { ringtone.resolve('vocivo_classic'); push.resolve('device-token'); });
  expect(applyIncomingRingtone).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(inputs.setPushRegistration).not.toHaveBeenCalled();
});

test.each([{ loading: true, isAuthenticated: true }, { loading: false, isAuthenticated: false }])('startup still waits for verified authentication: %s', async (auth) => {
  inputs = { ...inputs, ...auth };
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(api.get).not.toHaveBeenCalled();
  expect(ensureSipRegistration).not.toHaveBeenCalled();
});


test('managed push launch saves the validated cached session before mounting its runtime', async () => {
  (api.get as jest.Mock).mockResolvedValue({ voice_edge: 'telnyx' });
  jest.mocked(TelnyxVoipClient.isLaunchedFromPushNotification).mockResolvedValueOnce(true);
  const cached = { iceServers: undefined, token: 'cached-carrier-token', expiresAt: Date.now() + 3600_000, ringtone: 'system' as const };
  jest.mocked(loadVoiceSession).mockResolvedValueOnce(cached);
  const saved = deferred<void>();
  jest.mocked(persistVoiceSession).mockReturnValueOnce(saved.promise);
  inputs.onEngineSelected = jest.fn();
  await act(async () => { tree = TestRenderer.create(<Probe />); });
  expect(persistVoiceSession).toHaveBeenCalledWith(cached);
  expect(inputs.onEngineSelected).not.toHaveBeenCalled();
  await act(async () => { saved.resolve(); });
  expect(inputs.onEngineSelected).toHaveBeenCalledWith('telnyx');
  expect(api.post).not.toHaveBeenCalledWith('/api/telnyx/token', expect.anything());
  expect(voipClient.loginWithToken).not.toHaveBeenCalled(); // The managed push runtime performs this login.
});
