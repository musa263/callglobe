import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  saveProfile: (profile: BusinessProfile) => Promise<void>;
};

const storageKey = (scope: string) => `vocivo.business-profile.v3.${scope}`;
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
  const [loading, setLoading] = useState(true);
  const businessAccount = isAuthenticated && authProfile?.account_type === 'business';
  const scope = businessAccount && authProfile.organization_id && authProfile.id ? `${authProfile.organization_id}:${authProfile.id}` : '';
  const [loadedScope, setLoadedScope] = useState('');
  const activeScope = useRef(scope);
  activeScope.current = scope;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const defaults = defaultProfile(authProfile?.organization_name);
      setProfile(defaults);
      setLoadedScope(scope);
      setLoading(Boolean(scope));
      if (!scope) return;
      try {
        const cached = await AsyncStorage.getItem(storageKey(scope));
        if (cached && active) {
          const parsed = JSON.parse(cached) as Partial<BusinessProfile> & { departmentOne?: string; departmentTwo?: string };
          setProfile({ ...defaults, ...parsed, departments: parsed.departments?.length ? parsed.departments : [parsed.departmentOne || 'Sales', parsed.departmentTwo || 'Operations'] });
        }
        if (active) {
          const result = await api.get<{ config: Omit<BusinessProfile, 'aiTone'> }>('/api/voice/settings');
          if (active) setProfile((current) => ({ ...current, ...result.config }));
        }
      } catch { console.warn('[Vocivo Business] Company settings could not be refreshed.'); }
      finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [scope, authProfile?.organization_name]);

  const saveProfile = useCallback(async (next: BusinessProfile) => {
    if (!scope || !['company_owner', 'company_admin', 'admin', 'owner', 'superadmin'].includes(authProfile?.role || '')) {
      throw new Error('Company administrator access is required.');
    }
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
    if (activeScope.current === scope) setProfile(normalized);
    await AsyncStorage.setItem(storageKey(scope), JSON.stringify(normalized));
  }, [scope, authProfile?.role, isAuthenticated]);

  const value = useMemo(() => ({ profile: scope && loadedScope === scope ? profile : defaultProfile(authProfile?.organization_name), loading: Boolean(scope) && (loadedScope !== scope || loading), saveProfile }), [scope, loadedScope, authProfile?.organization_name, loading, profile, saveProfile]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const value = useContext(BusinessContext);
  if (!value) throw new Error('useBusiness must be used inside BusinessProvider');
  return value;
}
