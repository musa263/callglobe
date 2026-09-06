import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { ActiveCall } from '../../src/shared/types';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-localization', () => ({ useLocales: () => [{ regionCode: 'AE' }] }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('../../src/features/calling/components/RatePicker', () => ({ RatePicker: () => null }));
jest.mock('../../src/features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'self', extension: '2000' }, rates: [], callerNumbers: [] }) }));
jest.mock('../../src/shared/api', () => ({ api: { get: jest.fn(async () => ({ users: [] })) } }));
jest.mock('../../src/features/contacts/contactDirectory', () => ({ findPhoneContact: jest.fn(async () => null) }));
jest.mock('../../src/features/calling/VoiceContext', () => ({ useVoice: () => mockVoice }));

const mockVoice = {
  activeCall: null as ActiveCall | null,
  duration: 12,
  endCall: jest.fn(async () => undefined),
  answerCall: jest.fn(async () => undefined),
  toggleMute: jest.fn(), toggleHold: jest.fn(), toggleSpeaker: jest.fn(), sendDtmf: jest.fn(),
};
import { ActiveCallScreen } from '../../src/features/calling/screens/ActiveCallScreen';

let renderer: TestRenderer.ReactTestRenderer;
const call: ActiveCall = {
  id: 'call', number: '2001', displayName: 'Jamie Roberts', destinationCountry: 'Internal',
  phase: 'ringing', startedAt: 1, muted: false, speaker: false, onHold: false,
};
const button = (label: string) => {
  const found = renderer.root.findAll((item) => item.props.accessibilityLabel === label && typeof item.props.onPress === 'function')[0];
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
};
const texts = () => renderer.root.findAllByType(Text).map((item) => item.props.children);
const mount = async (value: ActiveCall | null = call) => {
  mockVoice.activeCall = value;
  await act(async () => { renderer = TestRenderer.create(<ActiveCallScreen onMinimize={jest.fn()} />); });
};
beforeEach(() => jest.clearAllMocks());
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

test('outgoing ringing shows the colleague and no pre-answer timer', async () => {
  await mount();
  expect(texts()).toEqual(expect.arrayContaining(['Jamie Roberts', 'JR', 'Extension 2001', 'Calling']));
  expect(texts()).not.toContain('00:12');
  expect(texts()).not.toContain('00:00');
});

test('incoming call exposes distinct answer and decline actions', async () => {
  await mount({ ...call, isIncoming: true });
  expect(texts()).toContain('Ringing');
  await act(async () => { await button('Answer incoming call').props.onPress(); });
  expect(mockVoice.answerCall).toHaveBeenCalledTimes(1);
  expect(texts()).not.toContain('00:12');
  await act(async () => { await button('Decline incoming call').props.onPress(); });
  expect(mockVoice.endCall).toHaveBeenCalledTimes(1);
});

test('timer requires active state and confirmed connection timestamp', async () => {
  await mount({ ...call, phase: 'active' });
  expect(texts()).not.toContain('00:12');
  mockVoice.activeCall = { ...call, phase: 'active', connectedAt: 1 };
  act(() => renderer.update(<ActiveCallScreen onMinimize={jest.fn()} />));
  expect(texts()).toContain('00:12');
});

test('call controls forward to the existing engine and expose selected state', async () => {
  await mount({ ...call, phase: 'active', connectedAt: 1, muted: true, speaker: true, onHold: true });
  for (const label of ['Mute', 'Speaker', 'Resume']) {
    expect(button(label).props.accessibilityState.selected).toBe(true);
    act(() => button(label).props.onPress());
  }
  expect(mockVoice.toggleMute).toHaveBeenCalledTimes(1);
  expect(mockVoice.toggleSpeaker).toHaveBeenCalledTimes(1);
  expect(mockVoice.toggleHold).toHaveBeenCalledTimes(1);
});

test('terminated engine state removes the active screen', async () => {
  await mount(null);
  expect(renderer.toJSON()).toBeNull();
});
