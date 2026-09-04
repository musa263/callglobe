import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import type { CallerNumber, CallLog, CallRate, Profile } from '../types';
import { fallbackRates } from '../data/fallbackRates';
import { setVoiceSignedIn, signOutVoiceDevice } from '../lib/voipClient';

type AuthContextValue = {
  loading: boolean;
  isAuthenticated: boolean;
  profile: Profile | null;
  rates: CallRate[];
  callerNumbers: CallerNumber[];
  history: CallLog[];
  isPreview: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  enrollWithQr: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterPreview: () => void;
  refresh: () => Promise<void>;
  addHistory: (call: CallLog) => Promise<void>;
  updateProfile: (input: { fullName: string; jobTitle: string; department: string; mobile: string; location: string; bio: string; photo?: { base64: string; mimeType: string } }) => Promise<void>;
};

type LoginResponse = { token: string; profile: Omit<Profile, 'balance'> };
type SessionResponse = { profile: Omit<Profile, 'balance'> };
type AccountResponse = { balance: number | null; currency: string; rates: CallRate[]; can_call?: boolean };
type HistoryResponse = { calls: CallLog[] };
type DirectoryResponse = { users: Array<{ id: string; extension: string; name: string; sipUsername: string }> };
type UserProfileResponse = { profile: { id: string; fullName: string; email: string; jobTitle: string; department: string; mobile: string; location: string; bio: string; photoUrl?: string } };
type BootstrapResponse = {
  profile: Omit<Profile, 'balance'>;
  account: AccountResponse;
  numbers: CallerNumber[];
  directory: DirectoryResponse['users'];
  calls: CallLog[];
};

function mobileProfile(value: UserProfileResponse['profile']): Omit<Profile, 'balance' | 'currency'> {
  return { id: value.id, email: value.email, full_name: value.fullName, photo_url: value.photoUrl, job_title: value.jobTitle, department: value.department, mobile: value.mobile, location: value.location, bio: value.bio };
}

/**
 * Every country, with the server's rates laid over the ones it names.
 *
 * The server's table lists only the destinations it has a price for, and it
 * used to replace the directory outright — so a country it had no line for,
 * the United Arab Emirates among them, could not be searched or dialled at
 * all. The web app has always merged; the phone now does the same.
 */
function normalizeRates(values: CallRate[]) {
  const known = new Map<string, CallRate>();
  for (const rate of values) {
    if (!rate?.id || !/^[A-Z]{2}$/.test(rate.country_code) || !/^\+\d{1,4}$/.test(rate.dial_code) || known.has(rate.country_code)) continue;
    known.set(rate.country_code, { ...rate, rate_per_min: Number(rate.rate_per_min) || 0 });
  }
  return fallbackRates.map((fallback) => {
    const rate = known.get(fallback.country_code);
    return rate ? { ...fallback, ...rate, id: fallback.id, flag: fallback.flag } : fallback;
  });
}

const legacyHistoryKey = 'vocivo.secure-history';
const historyKey = (userId: string) => `vocivo.history.v3.${userId}`;
const AuthContext = createContext<AuthContextValue | null>(null);

const previewProfile: Profile = { id: 'preview-user', email: 'preview@vocivo.app', full_name: 'Musa', job_title: 'Account owner', department: 'Operations', location: 'Riyadh', balance: 24.8, currency: 'USD' };
const previewNumbers: CallerNumber[] = [{ id: 'preview-number', phone_number: '+1 844 716 1777', label: 'Vocivo', country_code: 'US', status: 'active', receives_calls: true, source: 'owned' }];
const previewHistory: CallLog[] = [
  { id: '1', destination_number: '+966 50 421 8930', destination_country: 'Saudi Arabia', duration_seconds: 742, total_cost: 0.52, status: 'completed', started_at: new Date(Date.now() - 46 * 60 * 1000).toISOString() },
  { id: '2', destination_number: '+92 300 845 1192', destination_country: 'Pakistan', duration_seconds: 319, total_cost: 0.24, status: 'completed', started_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
  { id: '3', destination_number: '+44 7700 900112', destination_country: 'United Kingdom', duration_seconds: 0, total_cost: 0, status: 'no_answer', started_at: new Date(Date.now() - 3 * 86400000).toISOString() },
];

function initialProfile(baseProfile: Omit<Profile, 'balance'>): Profile {
  if (!baseProfile.id) throw new Error('Account identity was not returned.');
  if (baseProfile.admin_only) throw new Error('This administrator account uses the Vocivo web portal. Assign a calling extension before using the mobile app.');
  return { ...baseProfile, balance: null, currency: baseProfile.currency || 'USD' };
}

async function readHistory(userId: string) {
  const scopedKey = historyKey(userId);
  const value = await AsyncStorage.getItem(scopedKey) ?? (userId === 'vocivo-owner' ? await SecureStore.getItemAsync(legacyHistoryKey) : null);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as CallLog[];
    await AsyncStorage.setItem(scopedKey, JSON.stringify(parsed));
    return parsed;
  } catch { return []; }
}

function mergeHistory(local: CallLog[], server: CallLog[]) {
  const result: CallLog[] = [];
  for (const item of [...local, ...server].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    const digits = item.destination_number.replace(/\D/g, '');
    const started = new Date(item.started_at).getTime();
    const duplicateIndex = result.findIndex((candidate) => candidate.destination_number.replace(/\D/g, '') === digits && Math.abs(new Date(candidate.started_at).getTime() - started) < 30_000);
    if (duplicateIndex < 0) {
      result.push(item);
    } else {
      const existing = result[duplicateIndex];
      if (existing && item.destination_name && !existing.destination_name) result[duplicateIndex] = { ...existing, ...item };
    }
  }
  return result.slice(0, 100);
}

function normalizeHistoryIdentity(call: CallLog, directory: DirectoryResponse['users']) {
  const raw = String(call.destination_number || '').trim();
  const sipUser = raw.match(/^sip:([^@]+)@/i)?.[1];
  const colleague = sipUser
    ? directory.find((user) => user.sipUsername === sipUser)
    : call.destination_country === 'Internal'
      ? directory.find((user) => user.extension === raw.replace(/\D/g, ''))
      : undefined;
  if (!sipUser && !call.internal && call.destination_country !== 'Internal') return call;
  return {
    ...call,
    destination_number: colleague?.extension || (sipUser ? 'Internal extension' : raw),
    destination_name: call.destination_name && !/^sip:/i.test(call.destination_name) ? call.destination_name : colleague?.name || 'Internal call',
    destination_country: 'Internal',
    internal: true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rates, setRates] = useState<CallRate[]>(fallbackRates);
  const [callerNumbers, setCallerNumbers] = useState<CallerNumber[]>([]);
  const [history, setHistory] = useState<CallLog[]>([]);
  const historyRef = useRef<CallLog[]>([]);
  const directoryRef = useRef<DirectoryResponse['users']>([]);
  const activeUserIdRef = useRef<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [nativeBridgeError, setNativeBridgeError] = useState<Error | null>(null);

  useEffect(() => {
    setVoiceSignedIn(isAuthenticated && !isPreview)
      .then(() => setNativeBridgeError(null))
      .catch((failure) => {
        const error = failure instanceof Error ? failure : new Error(String(failure));
        console.error('[Vocivo Auth] native voice state synchronization failed', { message: error.message, stack: error.stack });
        setNativeBridgeError(error);
      });
  }, [isAuthenticated, isPreview]);

  const refreshServerHistory = useCallback(async (userId: string, directory: DirectoryResponse['users']) => {
    const server = await api.get<HistoryResponse>('/api/voice/history');
    if (activeUserIdRef.current !== userId) return;
    const merged = mergeHistory(
      historyRef.current.map((call) => normalizeHistoryIdentity(call, directory)),
      (server.calls ?? []).map((call) => normalizeHistoryIdentity(call, directory)),
    );
    historyRef.current = merged;
    setHistory(merged);
    await AsyncStorage.setItem(historyKey(userId), JSON.stringify(merged));
  }, []);

  const loadAccount = useCallback(async (baseProfile?: Omit<Profile, 'balance'>) => {
    if (!baseProfile) throw new Error('Account identity was not returned.');
    const basicProfile = initialProfile(baseProfile);
    activeUserIdRef.current = baseProfile.id;
    try {
      const bootstrap = await api.get<BootstrapResponse>('/api/mobile/bootstrap');
      const mergedProfile = { ...baseProfile, ...bootstrap.profile };
      setProfile({ ...mergedProfile, balance: bootstrap.account.balance == null ? null : Number(bootstrap.account.balance), can_call: bootstrap.account.can_call !== false, currency: bootstrap.account.currency });
      if (bootstrap.account.rates?.length) setRates(normalizeRates(bootstrap.account.rates));
      setCallerNumbers(bootstrap.numbers ?? []);
      const storedHistory = await readHistory(mergedProfile.id);
      directoryRef.current = bootstrap.directory || [];
      const mergedHistory = mergeHistory(
        storedHistory.map((call) => normalizeHistoryIdentity(call, directoryRef.current)),
        (bootstrap.calls ?? []).map((call) => normalizeHistoryIdentity(call, directoryRef.current)),
      );
      historyRef.current = mergedHistory;
      setHistory(mergedHistory);
      await AsyncStorage.setItem(historyKey(mergedProfile.id), JSON.stringify(mergedHistory));
      setTimeout(() => refreshServerHistory(mergedProfile.id, bootstrap.directory || []).catch(() => undefined), 5_000);
      return;
    } catch {
      const storedHistory = await readHistory(baseProfile.id);
      if (activeUserIdRef.current !== baseProfile.id) return;
      setProfile({ ...basicProfile, can_call: false });
      setCallerNumbers([]);
      historyRef.current = storedHistory;
      setHistory(storedHistory);
      return;
    }
  }, [refreshServerHistory]);

  useEffect(() => {
    const restore = async () => {
      try {
        if (!await api.getSessionToken()) return;
        const session = await api.get<SessionResponse>('/api/auth/session');
        setProfile(initialProfile(session.profile));
        setAuthenticated(true);
        void loadAccount(session.profile).catch(() => undefined);
      } catch (restoreError) {
        // Only discard the stored token when the server rejected it; a network
        // or server outage at launch must not sign the user out.
        const status = (restoreError as { status?: number } | null)?.status;
        if (status === 401 || status === 403) await api.clearSessionToken();
        setAuthenticated(false);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, [loadAccount]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const result = await api.post<LoginResponse>('/api/auth/login', { email: email.trim(), password });
      await api.saveSessionToken(result.token);
      setProfile(initialProfile(result.profile));
      setAuthenticated(true);
      setLoading(false);
      void loadAccount(result.profile).catch(() => undefined);
    } catch (error) {
      await api.clearSessionToken();
      setAuthenticated(false);
      setProfile(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [loadAccount]);

  const enrollWithQr = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const result = await api.post<LoginResponse>('/api/auth/enroll', { token });
      await api.saveSessionToken(result.token);
      setProfile(initialProfile(result.profile));
      setAuthenticated(true);
      setLoading(false);
      void loadAccount(result.profile).catch(() => undefined);
    } catch (error) {
      await api.clearSessionToken();
      setAuthenticated(false);
      setProfile(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [loadAccount]);

  const signOut = useCallback(async () => {
    await signOutVoiceDevice();
    setIsPreview(false);
    setAuthenticated(false);
    setProfile(null);
    activeUserIdRef.current = null;
    setCallerNumbers([]);
    historyRef.current = [];
    setHistory([]);
    await api.clearSessionToken();
  }, []);

  const enterPreview = useCallback(() => {
    setProfile(previewProfile);
    setRates(fallbackRates);
    setCallerNumbers(previewNumbers);
    historyRef.current = previewHistory;
    setHistory(previewHistory);
    setIsPreview(true);
  }, []);

  const refresh = useCallback(async () => {
    if (isPreview || !isAuthenticated) return;
    const session = await api.get<SessionResponse>('/api/auth/session');
    await loadAccount(session.profile);
    await refreshServerHistory(session.profile.id, directoryRef.current).catch(() => undefined);
  }, [isAuthenticated, isPreview, loadAccount, refreshServerHistory]);

  const addHistory = useCallback(async (call: CallLog) => {
    if (isPreview) return;
    const next = [call, ...historyRef.current.filter((item) => item.id !== call.id)].slice(0, 100);
    historyRef.current = next;
    setHistory(next);
    if (profile?.id) await AsyncStorage.setItem(historyKey(profile.id), JSON.stringify(next));
  }, [isPreview, profile?.id]);

  const updateProfile = useCallback(async (input: { fullName: string; jobTitle: string; department: string; mobile: string; location: string; bio: string; photo?: { base64: string; mimeType: string } }) => {
    if (isPreview) {
      setProfile((current) => current ? { ...current, full_name: input.fullName, job_title: input.jobTitle, department: input.department, mobile: input.mobile, location: input.location, bio: input.bio } : current);
      return;
    }
    const result = await api.put<UserProfileResponse>('/api/auth/profile', input);
    setProfile((current) => current ? { ...current, ...mobileProfile(result.profile) } : current);
  }, [isPreview]);

  const value = useMemo(() => ({ loading, isAuthenticated, profile, rates, callerNumbers, history, isPreview, signIn, enrollWithQr, signOut, enterPreview, refresh, addHistory, updateProfile }), [addHistory, callerNumbers, enrollWithQr, enterPreview, history, isAuthenticated, isPreview, loading, profile, rates, refresh, signIn, signOut, updateProfile]);
  if (nativeBridgeError) throw nativeBridgeError;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
