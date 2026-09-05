import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../shared/api';
import { useAuth } from '../auth/AuthContext';

export type BusinessProfile = {
  enabled: boolean;
  voicemailEnabled: boolean;
  voicemailDelaySeconds: number;
  voicemailGreeting: string;
  companyName: string;
  greeting: string;
  waitingMessage: string;
  departments: string[];
  voice: string;
  backgroundImageUrl: string;
  aiTone: 'professional' | 'friendly' | 'concise';
};

type BusinessContextValue = {
  profile: BusinessProfile;
  loading: boolean;
  callMode: 'personal' | 'business';
  setCallMode: (mode: 'personal' | 'business') => void;
  saveProfile: (profile: BusinessProfile) => Promise<void>;
};

const storageKey = (userId: string) => `vocivo.business-profile.v2.${userId}`;
const callModeStorageKey = (userId: string) => `vocivo.call-mode.v1.${userId}`;
const defaultProfile = (companyName = 'Your company'): BusinessProfile => ({
  enabled: false,
  voicemailEnabled: false,
  voicemailDelaySeconds: 25,
  voicemailGreeting: 'We are unable to answer your call. Please leave a message after the tone.',
  companyName,
  greeting: `Welcome to ${companyName}.`,
  waitingMessage: 'Thank you for waiting. A member of our team will be with you shortly.',
  departments: ['Sales', 'Operations'],
  voice: 'AWS.Polly.Joanna-Neural',
  backgroundImageUrl: '',
  aiTone: 'professional',
});
const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile: authProfile } = useAuth();
  const [profile, setProfile] = useState(() => defaultProfile());
  const [callModeState, setCallModeState] = useState<'personal' | 'business'>('personal');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const defaults = defaultProfile(authProfile?.organization_name);
      setProfile(defaults);
      setCallModeState(authProfile?.account_type === 'business' ? 'business' : 'personal');
      try {
        const [cached, cachedCallMode] = authProfile?.id ? await Promise.all([
          AsyncStorage.getItem(storageKey(authProfile.id)),
          AsyncStorage.getItem(callModeStorageKey(authProfile.id)),
        ]) : [null, null];
        if (cached && active) {
          const parsed = JSON.parse(cached) as Partial<BusinessProfile> & { departmentOne?: string; departmentTwo?: string };
          setProfile({ ...defaults, ...parsed, departments: parsed.departments?.length ? parsed.departments : [parsed.departmentOne || 'Sales', parsed.departmentTwo || 'Operations'] });
        }
        if (active && (cachedCallMode === 'personal' || cachedCallMode === 'business')) setCallModeState(cachedCallMode);
        if (isAuthenticated) {
          const result = await api.get<{ config: Omit<BusinessProfile, 'aiTone'> }>('/api/voice/settings');
          if (active) setProfile((current) => ({ ...current, ...result.config }));
        }
      } catch { /* Local profile remains available offline. */ }
      finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [authProfile?.id, isAuthenticated]);

  const saveProfile = useCallback(async (next: BusinessProfile) => {
    const normalized = {
      ...next,
      companyName: next.companyName.trim().slice(0, 80),
      greeting: next.greeting.trim().slice(0, 500),
      waitingMessage: next.waitingMessage.trim().slice(0, 500),
      voicemailDelaySeconds: Math.min(60, Math.max(15, Math.round(next.voicemailDelaySeconds || 25))),
      voicemailGreeting: next.voicemailGreeting.trim().slice(0, 500),
      departments: next.departments.map((department) => department.trim().slice(0, 40)).filter(Boolean).slice(0, 5),
    };
    if (isAuthenticated) {
      const result = await api.put<{ config: Omit<BusinessProfile, 'aiTone'> }>('/api/voice/settings', normalized);
      Object.assign(normalized, result.config);
    }
    setProfile(normalized);
    if (authProfile?.id) await AsyncStorage.setItem(storageKey(authProfile.id), JSON.stringify(normalized));
  }, [authProfile?.id, isAuthenticated]);

  const setCallMode = useCallback((mode: 'personal' | 'business') => {
    setCallModeState(mode);
    if (authProfile?.id) AsyncStorage.setItem(callModeStorageKey(authProfile.id), mode).catch(() => undefined);
  }, [authProfile?.id]);

  const value = useMemo(() => ({ profile, loading, callMode: callModeState, setCallMode, saveProfile }), [callModeState, loading, profile, saveProfile, setCallMode]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const value = useContext(BusinessContext);
  if (!value) throw new Error('useBusiness must be used inside BusinessProvider');
  return value;
}
