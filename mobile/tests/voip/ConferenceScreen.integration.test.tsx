import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-localization', () => ({ useLocales: () => [{ regionCode: 'AE' }] }));
jest.mock('../../src/features/calling/components/RatePicker', () => ({ RatePicker: () => null }));
jest.mock('../../src/features/auth/AuthContext', () => ({ useAuth: () => ({
  profile: mockProfile, rates: [], callerNumbers: [{ id: 'line', phone_number: '+12025550123', source: 'owned' }],
}) }));
jest.mock('../../src/shared/api', () => ({ api: {
  get: jest.fn(async () => ({ users: [{ id: 'jamie', name: 'Jamie', extension: '2001' }, { id: 'sam', name: 'Sam', extension: '2002' }] })),
  post: (...args: unknown[]) => mockPost(...args),
} }));
const mockPost = jest.fn<Promise<unknown>, unknown[]>();
let mockProfile = { id: 'self', extension: '2000', organization_id: 'company', account_type: 'business' };
import { ConferenceScreen } from '../../src/features/calling/screens/ConferenceScreen';

let renderer: TestRenderer.ReactTestRenderer;
const button = (label: string) => {
  const found = renderer.root.findAll((item) => item.props.accessibilityLabel === label && typeof item.props.onPress === 'function')[0];
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
};
const enter = (index: number, value: string) => act(() => {
  renderer.root.findAllByType(TextInput).find((item) => item.props.accessibilityLabel === `Participant ${index} number`)!.props.onChangeText(value);
});
beforeEach(async () => {
  mockPost.mockReset().mockResolvedValue({});
  mockProfile = { ...mockProfile, account_type: 'business' };
  await act(async () => { renderer = TestRenderer.create(<ConferenceScreen onDirect={jest.fn()} onWallet={jest.fn()} />); });
});
afterEach(() => act(() => renderer.unmount()));

test('mixed participants are inferred and sent with the existing authorized API contract', async () => {
  enter(1, '2001'); enter(2, '0501234567');
  await act(async () => { await button('Start conference').props.onPress(); });
  expect(mockPost).toHaveBeenCalledWith('/api/voice/conferences', { participants: [
    { type: 'extension', extensionId: 'jamie' }, { type: 'external', number: '+971501234567' },
  ], callerId: '+12025550123' });
});
test('individual account can conference regular numbers without an extension picker', async () => {
  mockProfile = { ...mockProfile, account_type: 'individual' };
  await act(async () => { renderer.update(<ConferenceScreen onDirect={jest.fn()} onWallet={jest.fn()} />); });
  enter(1, '+442079460018'); enter(2, '+12025550124');
  expect(renderer.root.findAll((item) => String(item.props.accessibilityLabel || '').startsWith('Choose colleague'))).toHaveLength(0);
  await act(async () => { await button('Start conference').props.onPress(); });
  expect(mockPost).toHaveBeenCalledWith('/api/voice/conferences', { participants: [
    { type: 'external', number: '+442079460018' }, { type: 'external', number: '+12025550124' },
  ], callerId: '+12025550123' });
});
test('two company extensions need no phone number or external mode selection', async () => {
  enter(1, '2001'); enter(2, '2002');
  await act(async () => { await button('Start conference').props.onPress(); });
  expect(mockPost).toHaveBeenCalledWith('/api/voice/conferences', { participants: [
    { type: 'extension', extensionId: 'jamie' }, { type: 'extension', extensionId: 'sam' },
  ] });
});
test('normalized duplicates, own extension and unknown extensions cannot start a conference', async () => {
  for (const pair of [['0501234567', '+971501234567'], ['2001', '2001'], ['2000', '2001'], ['2999', '2001']]) {
    enter(1, pair[0]!); enter(2, pair[1]!);
    expect(button('Start conference').props.disabled).toBe(true);
    await act(async () => { await button('Start conference').props.onPress(); });
  }
  expect(mockPost).not.toHaveBeenCalled();
});
test('same-frame duplicate taps create only one conference request', async () => {
  let finish!: (value: unknown) => void;
  mockPost.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  enter(1, '2001'); enter(2, '2002');
  let pending!: Promise<void>;
  act(() => { const start = button('Start conference').props.onPress; pending = start(); void start(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  await act(async () => { finish({}); await pending; });
});
