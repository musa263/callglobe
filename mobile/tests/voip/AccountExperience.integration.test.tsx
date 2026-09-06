import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../src/shared/components/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/features/calling/VoiceContext', () => ({ useVoice: () => ({ isReady: true }) }));
jest.mock('../../src/features/auth/AuthContext', () => ({ useAuth: () => ({ profile: mockProfile, isAuthenticated: true, callerNumbers: [], history: [], signInWithPhone: mockVerify }) }));
jest.mock('../../src/shared/api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args), post: (...args: unknown[]) => mockPost(...args) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: (...args: unknown[]) => mockRead(...args), setItem: jest.fn(async () => {}) }));
const mockGet = jest.fn<Promise<any>, unknown[]>();
const mockPut = jest.fn<Promise<any>, unknown[]>();
const mockPost = jest.fn<Promise<any>, unknown[]>();
const mockRead = jest.fn<Promise<any>, unknown[]>();
const mockVerify = jest.fn<Promise<void>, unknown[]>();
let mockProfile = { id: 'user', organization_id: 'tenant-a', organization_name: 'Company A', full_name: 'Alex Morgan', role: 'user', account_type: 'business', extension: '2000' };
import { BusinessProvider, useBusiness } from '../../src/features/organizations/BusinessContext';
import { PhoneSignupScreen } from '../../src/features/auth/screens/PhoneSignupScreen';
let business!: ReturnType<typeof useBusiness>;
function Probe() { business = useBusiness(); return null; }
let renderer: TestRenderer.ReactTestRenderer;
const buttons = (label: string) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function');
const input = (label: string) => renderer.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === label)!;
beforeEach(() => {
  mockProfile = { ...mockProfile, id: 'user', organization_id: 'tenant-a', role: 'user', account_type: 'business' };
  mockGet.mockReset().mockResolvedValue({ config: { companyName: 'Company A', enabled: true } });
  mockRead.mockReset().mockResolvedValue(null); mockPut.mockReset(); mockPost.mockReset(); mockVerify.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
test('company membership has no editable mode and employees cannot save company administration', async () => {
  await act(async () => { renderer = TestRenderer.create(<BusinessProvider><Probe /></BusinessProvider>); });
  expect(business).not.toHaveProperty('callMode');
  await expect(business.saveProfile(business.profile)).rejects.toThrow('administrator');
  expect(mockPut).not.toHaveBeenCalled();
});
test('individual account never reads company settings or old saved mode', async () => {
  mockProfile = { ...mockProfile, role: 'company_admin', account_type: 'individual' };
  await act(async () => { renderer = TestRenderer.create(<BusinessProvider><Probe /></BusinessProvider>); });
  expect(mockGet).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
  await expect(business.saveProfile({ ...business.profile, enabled: true })).rejects.toThrow('administrator');
  expect(mockPut).not.toHaveBeenCalled();
});
test('late company settings cannot appear after account becomes individual', async () => {
  let resolve!: (value: unknown) => void;
  mockGet.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => { renderer = TestRenderer.create(<BusinessProvider><Probe /></BusinessProvider>); });
  mockProfile = { ...mockProfile, id: 'personal', organization_id: 'personal-org', account_type: 'individual' };
  await act(async () => { renderer.update(<BusinessProvider><Probe /></BusinessProvider>); resolve({ config: { enabled: true, companyName: 'Old Company' } }); });
  expect(business.profile.enabled).toBe(false); expect(business.profile.companyName).not.toBe('Old Company');
});
test('phone form waits for a real challenge, prevents duplicate taps and verifies only that challenge', async () => {
  let resolve!: (value: unknown) => void;
  mockPost.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => { renderer = TestRenderer.create(<PhoneSignupScreen onBack={() => {}} />); });
  act(() => { input('Your name').props.onChangeText('Alex Morgan'); input('Phone number with country code').props.onChangeText('+12025550123'); });
  let pending!: Promise<void>;
  act(() => { const send = buttons('Send verification code')[0]!.props.onPress; pending = send(); void send(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockVerify).not.toHaveBeenCalled();
  await act(async () => { resolve({ challengeId: 'server-challenge', expiresAt: Date.now() + 300000, retryAfter: 60 }); await pending; });
  act(() => input('Verification code').props.onChangeText('123456'));
  await act(async () => { await buttons('Verify and continue')[0]!.props.onPress(); });
  expect(mockVerify).toHaveBeenCalledWith('server-challenge', '123456');
});
test('disabled OTP backend shows its error without a fake code-entry success', async () => {
  mockPost.mockRejectedValue(new Error('Phone signup is not available yet.'));
  await act(async () => { renderer = TestRenderer.create(<PhoneSignupScreen onBack={() => {}} />); });
  act(() => { input('Your name').props.onChangeText('Alex Morgan'); input('Phone number with country code').props.onChangeText('+12025550123'); });
  await act(async () => { await buttons('Send verification code')[0]!.props.onPress(); });
  expect(renderer.root.findAllByType(TextInput).some((node) => node.props.accessibilityLabel === 'Verification code')).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain('Phone signup is not available yet.');
});
