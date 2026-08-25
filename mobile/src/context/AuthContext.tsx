import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import type { CallerNumber, CallLog, CallRate, Profile } from '../types';
import { fallbackRates } from '../data/fallbackRates';

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
type AccountResponse = { balance: number; currency: string; rates: CallRate[] };
type NumbersResponse = { numbers: CallerNumber[] };
type UserProfileResponse = { profile: { id: string; fullName: string; email: string; jobTitle: string; department: string; mobile: string; location: string; bio: string; photoUrl?: string } };

function mobileProfile(value: UserProfileResponse['profile']): Omit<Profile, 'balance' | 'currency'> {
  return { id: value.id, email: value.email, full_name: value.fullName, photo_url: value.photoUrl, job_title: value.jobTitle, department: value.department, mobile: value.mobile, location: value.location, bio: value.bio };
}

function normalizeRates(values: CallRate[]) {
  const seen = new Set<string>();
  return values.filter((rate) => {
    if (!rate?.id || !/^[A-Z]{2}$/.test(rate.country_code) || !/^\+\d{1,4}$/.test(rate.dial_code) || seen.has(rate.id)) return false;
    seen.add(rate.id);
    return true;
  }).map((rate) => ({ ...rate, rate_per_min: Number(rate.rate_per_min) || 0 }));
}

const historyKey = 'vocivo.history.v2';
const legacyHistoryKey = 'vocivo.secure-history';
const AuthContext = createContext<AuthContextValue | null>(null);

const previewProfile: Profile = { id: 'preview-user', email: 'preview@vocivo.app', full_name: 'Musa', job_title: 'Account owner', department: 'Operations', location: 'Riyadh', balance: 24.8, currency: 'USD' };
const previewNumbers: CallerNumber[] = [{ id: 'preview-number', phone_number: '+1 844 716 1777', label: 'Vocivo', country_code: 'US', status: 'active', receives_calls: true, source: 'owned' }];
const previewHistory: CallLog[] = [
  { id: '1', destination_number: '+966 50 421 8930', destination_country: 'Saudi Arabia', duration_seconds: 742, total_cost: 0.52, status: 'completed', started_at: new Date(Date.now() - 46 * 60 * 1000).toISOString() },
  { id: '2', destination_number: '+92 300 845 1192', destination_country: 'Pakistan', duration_seconds: 319, total_cost: 0.24, status: 'completed', started_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
  { id: '3', destination_number: '+44 7700 900112', destination_country: 'United Kingdom', duration_seconds: 0, total_cost: 0, status: 'no_answer', started_at: new Date(Date.now() - 3 * 86400000).toISOString() },
];

async function readHistory() {
  const value = await AsyncStorage.getItem(historyKey) ?? await SecureStore.getItemAsync(legacyHistoryKey);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as CallLog[];
    await AsyncStorage.setItem(historyKey, JSON.stringify(parsed));
    return parsed;
  } catch { return []; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rates, setRates] = useState<CallRate[]>(fallbackRates);
  const [callerNumbers, setCallerNumbers] = useState<CallerNumber[]>([]);
  const [history, setHistory] = useState<CallLog[]>([]);
  const historyRef = useRef<CallLog[]>([]);
  const [isPreview, setIsPreview] = useState(false);

  const loadAccount = useCallback(async (baseProfile?: Omit<Profile, 'balance'>) => {
    const [account, numbers, verified, storedHistory, userProfile] = await Promise.all([api.get<AccountResponse>('/api/telnyx/account'), api.get<NumbersResponse>('/api/telnyx/numbers'), api.get<NumbersResponse>('/api/telnyx/verified-numbers'), readHistory(), api.get<UserProfileResponse>('/api/auth/profile')]);
    const details = mobileProfile(userProfile.profile);
    if (baseProfile) setProfile({ ...baseProfile, ...details, balance: Number(account.balance), currency: account.currency });
    else setProfile((current) => current ? { ...current, ...details, balance: Number(account.balance), currency: account.currency } : { ...details, balance: Number(account.balance), currency: account.currency });
    if (account.rates?.length) setRates(normalizeRates(account.rates));
    setCallerNumbers([...(numbers.numbers ?? []), ...(verified.numbers ?? [])]);
    historyRef.current = storedHistory;
    setHistory(storedHistory);
  }, []);

  useEffect(() => {
    const restore = async () => {
      try {
        if (!await api.getSessionToken()) return;
        const session = await api.get<SessionResponse>('/api/auth/session');
        setAuthenticated(true);
        await loadAccount(session.profile);
      } catch {
        await api.clearSessionToken();
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, [loadAccount]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResponse>('/api/auth/login', { email: email.trim(), password });
    await api.saveSessionToken(result.token);
    setAuthenticated(true);
    await loadAccount(result.profile);
  }, [loadAccount]);

  const enrollWithQr = useCallback(async (token: string) => {
    const result = await api.post<LoginResponse>('/api/auth/enroll', { token });
    await api.saveSessionToken(result.token);
    setAuthenticated(true);
    await loadAccount(result.profile);
  }, [loadAccount]);

  const signOut = useCallback(async () => {
    setIsPreview(false);
    setAuthenticated(false);
    setProfile(null);
    setCallerNumbers([]);
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
    await loadAccount();
  }, [isAuthenticated, isPreview, loadAccount]);

  const addHistory = useCallback(async (call: CallLog) => {
    if (isPreview) return;
    const next = [call, ...historyRef.current.filter((item) => item.id !== call.id)].slice(0, 100);
    historyRef.current = next;
    setHistory(next);
    await AsyncStorage.setItem(historyKey, JSON.stringify(next));
  }, [isPreview]);

  const updateProfile = useCallback(async (input: { fullName: string; jobTitle: string; department: string; mobile: string; location: string; bio: string; photo?: { base64: string; mimeType: string } }) => {
    if (isPreview) {
      setProfile((current) => current ? { ...current, full_name: input.fullName, job_title: input.jobTitle, department: input.department, mobile: input.mobile, location: input.location, bio: input.bio } : current);
      return;
    }
    const result = await api.put<UserProfileResponse>('/api/auth/profile', input);
    setProfile((current) => current ? { ...current, ...mobileProfile(result.profile) } : current);
  }, [isPreview]);

  const value = useMemo(() => ({ loading, isAuthenticated, profile, rates, callerNumbers, history, isPreview, signIn, enrollWithQr, signOut, enterPreview, refresh, addHistory, updateProfile }), [addHistory, callerNumbers, enrollWithQr, enterPreview, history, isAuthenticated, isPreview, loading, profile, rates, refresh, signIn, signOut, updateProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
