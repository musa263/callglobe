import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';

let mockSdkLoads = 0;
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ marker: 'managed-client', logout: jest.fn(), disablePushNotifications: jest.fn() }));
jest.mock('@telnyx/react-voice-commons-sdk', () => {
  mockSdkLoads++;
  return {
    createTelnyxVoipClient: (...args: unknown[]) => mockCreateClient(...args),
    TelnyxVoiceApp: () => null,
    createTokenConfig: (token: string) => ({ token }),
    TelnyxVoipClient: { isLaunchedFromPushNotification: async () => false },
  };
});
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: { VoicePnBridge: {
    getVoipToken: jest.fn(async () => 'native-push-token'),
    setIncomingCallRingtone: jest.fn(async () => true),
    setVocivoVoiceSignedIn: jest.fn(async () => true),
    isSpeakerEnabled: jest.fn(async () => true),
    setSpeakerEnabled: jest.fn(async () => false),
  } },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { setItem: jest.fn(), multiRemove: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({ deleteItemAsync: jest.fn() }));

import { getVoicePushToken, setVoiceSignedIn, signOutVoiceDevice } from '../../src/features/calling/runtime/voipClient';
import { VoicePnBridge } from '../../src/features/calling/runtime/nativeVoiceBridge';
import { getManagedVoiceClient, ManagedVoiceRuntime } from '../../src/features/calling/runtime/managedVoiceRuntime';

test('SIP-compatible native controls and sign-out never initialize the managed JS SDK', async () => {
  expect(mockSdkLoads).toBe(0);
  expect(mockCreateClient).not.toHaveBeenCalled();
  expect(await getVoicePushToken()).toBe('native-push-token');
  await setVoiceSignedIn(true);
  await VoicePnBridge.setIncomingCallRingtone('vocivo_classic');
  expect(NativeModules.VoicePnBridge.setIncomingCallRingtone).not.toHaveBeenCalled();
  (Platform as { OS: string }).OS = 'android';
  try {
    await VoicePnBridge.setIncomingCallRingtone('vocivo_classic');
    expect(NativeModules.VoicePnBridge.setIncomingCallRingtone).toHaveBeenCalledWith('vocivo_classic');
  } finally { (Platform as { OS: string }).OS = 'ios'; }
  expect(await VoicePnBridge.toggleSpeaker()).toBe(false); // false is an audio route, not failure.
  await signOutVoiceDevice();
  expect(mockSdkLoads).toBe(0);
  expect(mockCreateClient).not.toHaveBeenCalled();
});

test('an explicitly mounted managed runtime shares one lazily created client', async () => {
  const first = getManagedVoiceClient();
  expect(getManagedVoiceClient()).toBe(first);
  let tree: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { tree = TestRenderer.create(<ManagedVoiceRuntime />); });
    expect(mockSdkLoads).toBe(1);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  } finally { await act(async () => tree?.unmount()); }
});
