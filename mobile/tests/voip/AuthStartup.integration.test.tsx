import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockStorage = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockStorage.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
}));
jest.mock('../../src/shared/api', () => ({ api: {
  getSessionToken: jest.fn(), clearSessionToken: jest.fn(async () => {}), saveSessionToken: jest.fn(async () => {}),
  get: jest.fn(), post: jest.fn(), put: jest.fn(),
} }));
jest.mock('../../src/features/calling/runtime/voipClient', () => ({
  setVoiceSignedIn: jest.fn(async () => {}), signOutVoiceDevice: jest.fn(async () => {}),
}));
import { api } from '../../src/shared/api';
import { AuthProvider, useAuth } from '../../src/features/auth/AuthContext';
import { readSessionSnapshot } from '../../src/features/auth/sessionSnapshot';
import { setVoiceSignedIn } from '../../src/features/calling/runtime/voipClient';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const profile = { id: 'employee-a', full_name: 'Colleague', email: 'a@example.test', organization_id: 'tenant-a' };
const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
let current: ReturnType<typeof useAuth>;
let renderer: TestRenderer.ReactTestRenderer | undefined;
let session: ReturnType<typeof deferred<{ profile: typeof profile }>>;
let bootstrap: ReturnType<typeof deferred<unknown>>;
function Probe() { current = useAuth(); return null; }
async function mount() { await act(async () => { renderer = TestRenderer.create(<AuthProvider><Probe /></AuthProvider>); }); }
function cache(value = token) { mockStorage.set('vocivo.account-snapshot.v1', JSON.stringify({ token: value, profile, savedAt: Date.now() })); }

beforeEach(() => {
  jest.clearAllMocks(); mockStorage.clear();
  session = deferred(); bootstrap = deferred();
  jest.mocked(api.getSessionToken).mockResolvedValue(token);
  jest.mocked(api.get).mockImplementation((path) => (path === '/api/auth/session' ? session.promise : bootstrap.promise) as never);
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

test('cached account renders without waiting for session HTTP or account bootstrap', async () => {
  cache(); await mount();
  expect(current.loading).toBe(false); expect(current.isAuthenticated).toBe(true);
  expect(current.profile?.id).toBe(profile.id);
  expect(current.profile?.balance).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/api/auth/session');
  expect(api.get).not.toHaveBeenCalledWith('/api/mobile/bootstrap');
  expect(setVoiceSignedIn).not.toHaveBeenCalledWith(false);
});

test('fresh installation exposes no cached account before server verification', async () => {
  await mount(); expect(current.loading).toBe(true); expect(current.isAuthenticated).toBe(false);
  await act(async () => session.resolve({ profile }));
  expect(current.loading).toBe(false); expect(current.isAuthenticated).toBe(true);
  expect(api.get).toHaveBeenCalledWith('/api/mobile/bootstrap');
});

test('cached presentation cannot cross login tokens or accept an expired token', async () => {
  cache('another-login'); expect(await readSessionSnapshot(token)).toBeNull();
  const expired = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
  cache(expired); expect(await readSessionSnapshot(expired)).toBeNull();
});

test('revoked server session removes cached account and native sign-in gate', async () => {
  cache(); await mount();
  await act(async () => session.reject(Object.assign(new Error('Unauthorized'), { status: 401 })));
  expect(current.isAuthenticated).toBe(false); expect(current.profile).toBeNull();
  expect(api.clearSessionToken).toHaveBeenCalled();
  expect(mockStorage.has('vocivo.account-snapshot.v1')).toBe(false);
  expect(setVoiceSignedIn).toHaveBeenLastCalledWith(false);
});

test('temporary network failure preserves cached account without claiming a calling balance', async () => {
  cache(); await mount();
  await act(async () => session.reject(new TypeError('offline')));
  expect(current.isAuthenticated).toBe(true); expect(current.loading).toBe(false);
  expect(current.profile?.balance).toBeNull(); expect(api.clearSessionToken).not.toHaveBeenCalled();
});

test('pending session response cannot resurrect a signed-out account', async () => {
  cache(); await mount();
  await act(async () => current.signOut());
  await act(async () => session.resolve({ profile }));
  expect(current.isAuthenticated).toBe(false); expect(current.profile).toBeNull();
});

test('pending account bootstrap cannot restore data after sign-out', async () => {
  await mount(); await act(async () => session.resolve({ profile }));
  await act(async () => current.signOut());
  await act(async () => bootstrap.resolve({ profile, account: { balance: 100, currency: 'USD', rates: [] }, numbers: [], calls: [], directory: [] }));
  expect(current.profile).toBeNull(); expect(current.history).toEqual([]); expect(current.callerNumbers).toEqual([]);
});
