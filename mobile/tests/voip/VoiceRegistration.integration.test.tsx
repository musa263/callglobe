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
jest.mock('../../src/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../src/lib/ringtone', () => ({
  applyIncomingRingtone: jest.fn(async () => undefined),
  loadIncomingRingtone: jest.fn(async () => 'system'),
}));
jest.mock('../../src/lib/voipClient', () => ({
  getVoicePushToken: jest.fn(async () => 'device-token'),
  persistVoiceSession: jest.fn(async () => undefined),
  voipClient: { loginWithToken: jest.fn() },
}));
jest.mock('../../src/lib/sipNative', () => ({
  refreshVocivoSip: jest.fn(async () => undefined),
  ensureSipRegistration: jest.fn(async () => 3600),
}));
jest.mock('../../src/voice/engines', () => ({
  sipEngine: () => ({ name: 'sip', client: {}, platform: {} }),
  telnyxEngine: () => ({ name: 'telnyx', client: {}, platform: {} }),
}));
jest.mock('../../src/voice/voiceClientFacade', () => ({
  voice: { use: jest.fn(), logout: jest.fn(async () => undefined) },
}));

import { api } from '../../src/lib/api';
import { ensureSipRegistration } from '../../src/lib/sipNative';
import { persistVoiceSession, voipClient } from '../../src/lib/voipClient';
import { useVoiceRegistration } from '../../src/voice/useVoiceRegistration';

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
    isAuthenticated: true, isPreview: false, loading: false,
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
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registering');
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  const deviceWrites = (api.post as jest.Mock).mock.calls.filter(([path]) => path === '/api/voice/devices');
  expect(deviceWrites).toHaveLength(2);
  expect(inputs.setPushRegistration).toHaveBeenLastCalledWith('registered');
});
