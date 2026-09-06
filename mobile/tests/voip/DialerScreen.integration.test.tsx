import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-localization', () => ({ useLocales: () => [{ regionCode: 'AE' }] }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('../../src/features/calling/components/NetworkStrength', () => ({ NetworkStrength: () => null }));
jest.mock('../../src/shared/api', () => ({ api: { get: (...args: unknown[]) => mockDirectory(...args) } }));
jest.mock('../../src/features/auth/AuthContext', () => ({ useAuth: () => ({
  profile: mockProfile,
  callerNumbers: [{ id: 'line', phone_number: '+12025550123', label: 'Company line', source: 'owned' }],
  rates: [],
}) }));
jest.mock('../../src/features/calling/VoiceContext', () => ({ useVoice: () => ({
  isReady: true, startCall: mockStartCall, startInternalCall: mockStartInternalCall,
}) }));
const mockStartCall = jest.fn<Promise<void>, any[]>();
const mockStartInternalCall = jest.fn<Promise<void>, any[]>();
const mockDirectory = jest.fn<Promise<any>, unknown[]>();
let mockProfile = { id: 'self', organization_id: 'company-a', extension: '2000', account_type: 'business', organization_name: 'Test Company', balance: null };
import { DialerScreen } from '../../src/features/calling/screens/DialerScreen';

let renderer: TestRenderer.ReactTestRenderer;
const props = { onWallet: jest.fn(), onConference: jest.fn(), target: null };
const button = (label: string) => {
  const found = renderer.root.findAll((item) => item.props.accessibilityLabel === label && typeof item.props.onPress === 'function')[0];
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
};
beforeEach(() => {
  mockProfile = { ...mockProfile, id: 'self', organization_id: 'company-a', account_type: 'business' };
  mockDirectory.mockReset().mockResolvedValue({ users: [
    { id: 'colleague', extension: '2001', name: 'Colleague' },
    { id: 'second', extension: '2002', name: 'Second Colleague' },
  ] });
  mockStartCall.mockReset().mockResolvedValue(undefined); mockStartInternalCall.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

test('pasted international number is not prefixed with the device country code', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  act(() => renderer.root.findByType(TextInput).props.onChangeText('+44 20 7946 0018'));
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartCall.mock.calls[0]?.[0]).toBe('+442079460018');
});

test('Dial Pad exposes the keypad and one conference icon without a Home or recent-calls panel', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  const content = JSON.stringify(renderer.toJSON());
  expect(content).toContain('Dial Pad');
  expect(content).toContain('Dial 1');
  expect(content).not.toContain('Recent calls');
  expect(content).not.toContain('Back to home');
  expect(content).not.toContain('New call');
  expect(button('Start conference').findAllByType(require('react-native').Text)).toHaveLength(0);
});

test('individual account has conference access without company directory access', async () => {
  mockProfile = { ...mockProfile, account_type: 'individual' };
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  expect(mockDirectory).not.toHaveBeenCalled();
  expect(button('Start conference')).toBeTruthy();
  act(() => renderer.root.findByType(TextInput).props.onChangeText('2001'));
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartInternalCall).not.toHaveBeenCalled();
});
test('national contact number uses its country and retains its identity', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} target={{ number: '02079460018', countryCode: 'GB', name: 'Alex', nonce: 1 }} />); });
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartCall.mock.calls[0]?.[0]).toBe('+442079460018');
  expect(mockStartCall.mock.calls[0]?.[3]).toBe('Alex');
});
test('local digits use the device region and duplicate taps place only one call', async () => {
  let finish!: () => void;
  mockStartCall.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  act(() => renderer.root.findByType(TextInput).props.onChangeText('0501234567'));
  let pending!: Promise<void>;
  act(() => { const press = button('Start call').props.onPress; pending = press(); void press(); });
  expect(mockStartCall).toHaveBeenCalledTimes(1);
  expect(mockStartCall.mock.calls[0]?.[0]).toBe('+971501234567');
  expect(button('Starting call').props.disabled).toBe(true);
  await act(async () => { finish(); await pending; });
});
test('short extension stays internal and does not require a caller number or prefix', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} target={{ number: '2001', internal: true, name: 'Colleague', nonce: 1 }} />); });
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartInternalCall).toHaveBeenCalledWith('', '2001', 'Colleague', undefined);
  expect(mockStartCall).not.toHaveBeenCalled();
});
test('editing a contact to an extension automatically selects its directory identity', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} target={{ number: '+442079460018', name: 'Alex', nonce: 1 }} />); });
  act(() => renderer.root.findByType(TextInput).props.onChangeText('2002'));
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartInternalCall).toHaveBeenCalledWith('', '2002', 'Second Colleague', undefined);
});

test('one input switches from an extension to a full number without truncation or tabs', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  expect(renderer.root.findAll((item) => item.props.accessibilityRole === 'tab')).toHaveLength(0);
  act(() => renderer.root.findByType(TextInput).props.onChangeText('2001'));
  expect(button('Start call').props.disabled).toBe(false);
  act(() => renderer.root.findByType(TextInput).props.onChangeText('+442079460018'));
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartInternalCall).not.toHaveBeenCalled();
  expect(mockStartCall.mock.calls[0]?.[0]).toBe('+442079460018');
  act(() => button('Start conference').props.onPress());
  expect(props.onConference).toHaveBeenCalled();
});

test('unknown and self extensions cannot fall through to external dialing', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  for (const value of ['2999', '2000']) {
    act(() => renderer.root.findByType(TextInput).props.onChangeText(value));
    expect(button('Start call').props.disabled).toBe(true);
    await act(async () => { await button('Start call').props.onPress(); });
  }
  expect(mockStartCall).not.toHaveBeenCalled();
  expect(mockStartInternalCall).not.toHaveBeenCalled();
});

test('a pending directory does not delay an external call', async () => {
  mockDirectory.mockImplementation(() => new Promise(() => {}));
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  act(() => renderer.root.findByType(TextInput).props.onChangeText('+442079460018'));
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartCall).toHaveBeenCalledTimes(1);
});

test('a workspace change hides the previous directory before the new request resolves', async () => {
  await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
  act(() => renderer.root.findByType(TextInput).props.onChangeText('2001'));
  expect(button('Start call').props.disabled).toBe(false);
  let finish!: (value: unknown) => void;
  mockDirectory.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mockProfile = { ...mockProfile, id: 'other', organization_id: 'company-b' };
  act(() => renderer.update(<DialerScreen {...props} />));
  expect(button('Start call').props.disabled).toBe(true);
  await act(async () => { finish({ users: [{ id: 'new', extension: '2001', name: 'New Tenant Colleague' }] }); });
  await act(async () => { await button('Start call').props.onPress(); });
  expect(mockStartInternalCall).toHaveBeenCalledWith('', '2001', 'New Tenant Colleague', undefined);
});

test('directory failure has a retry and never authorizes an unknown extension', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    mockDirectory.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { renderer = TestRenderer.create(<DialerScreen {...props} />); });
    act(() => renderer.root.findByType(TextInput).props.onChangeText('2001'));
    expect(button('Start call').props.disabled).toBe(true);
    await act(async () => { button('Retry company directory').props.onPress(); });
    expect(button('Start call').props.disabled).toBe(false);
  } finally { warning.mockRestore(); }
});
