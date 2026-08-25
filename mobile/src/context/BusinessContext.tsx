import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

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
  saveProfile: (profile: BusinessProfile) => Promise<void>;
};

const storageKey = 'vocivo.business-profile.v1';
const defaultProfile: BusinessProfile = {
  enabled: false,
  voicemailEnabled: false,
  voicemailDelaySeconds: 25,
  voicemailGreeting: 'We are unable to answer your call. Please leave a message after the tone.',
  companyName: 'Global Heritage',
  greeting: 'Welcome to Global Heritage.',
  waitingMessage: 'Thank you for waiting. A member of our team will be with you shortly.',
  departments: ['Sales', 'Operations'],
  voice: 'AWS.Polly.Joanna-Neural',
  backgroundImageUrl: '',
  aiTone: 'professional',
};
const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isPreview } = useAuth();
  const [profile, setProfile] = useState(defaultProfile);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const cached = await AsyncStorage.getItem(storageKey);
        if (cached && active) {
          const parsed = JSON.parse(cached) as Partial<BusinessProfile> & { departmentOne?: string; departmentTwo?: string };
          setProfile({ ...defaultProfile, ...parsed, departments: parsed.departments?.length ? parsed.departments : [parsed.departmentOne || 'Sales', parsed.departmentTwo || 'Operations'] });
        }
        if (isAuthenticated && !isPreview) {
          const result = await api.get<{ config: Omit<BusinessProfile, 'aiTone'> }>('/api/voice/settings');
          if (active) setProfile((current) => ({ ...current, ...result.config }));
        }
      } catch { /* Local profile remains available offline. */ }
      finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [isAuthenticated, isPreview]);

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
    if (isAuthenticated && !isPreview) {
      const result = await api.put<{ config: Omit<BusinessProfile, 'aiTone'> }>('/api/voice/settings', normalized);
      Object.assign(normalized, result.config);
    }
    setProfile(normalized);
    await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  }, [isAuthenticated, isPreview]);

  const value = useMemo(() => ({ profile, loading, saveProfile }), [loading, profile, saveProfile]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const value = useContext(BusinessContext);
  if (!value) throw new Error('useBusiness must be used inside BusinessProvider');
  return value;
}
