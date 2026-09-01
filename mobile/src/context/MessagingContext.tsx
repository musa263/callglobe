import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import type { SmsMessage } from '../types';
import { useAuth } from './AuthContext';

type MessagingContextValue = {
  messages: SmsMessage[];
  loading: boolean;
  refreshMessages: () => Promise<void>;
  sendMessage: (to: string, text: string, contactName?: string, transport?: 'sms' | 'internal') => Promise<void>;
  suggestReplies: (input: { draft: string; recipient: string; companyName?: string; tone?: string; context?: string[] }) => Promise<string[]>;
};

const storageKey = (userId: string) => `vocivo.messages.v2.${userId}`;
const MessagingContext = createContext<MessagingContextValue | null>(null);
const e164 = /^\+[1-9]\d{6,14}$/;

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile, callerNumbers } = useAuth();
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMessages = useCallback(async () => {
    if (!isAuthenticated || !profile?.id) { setMessages([]); setLoading(false); return; }
    try {
      const result = await api.get<{ messages: SmsMessage[] }>('/api/telnyx/messages');
      setMessages((current) => {
        const localPending = current.filter((message) => message.id.startsWith('local-') || message.status === 'failed');
        const remote = (result.messages ?? []).map((message) => ({ ...message, direction: message.direction ?? 'outbound' as const }));
        const merged = [...localPending, ...remote].filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index).slice(0, 200);
        AsyncStorage.setItem(storageKey(profile.id), JSON.stringify(merged)).catch(() => undefined);
        return merged;
      });
    } finally { setLoading(false); }
  }, [isAuthenticated, profile?.id]);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setLoading(true);
    if (!isAuthenticated || !profile?.id) { setLoading(false); return undefined; }
    AsyncStorage.getItem(storageKey(profile.id)).then((value) => {
      if (value && active) setMessages((JSON.parse(value) as SmsMessage[]).map((message) => ({ ...message, direction: message.direction ?? 'outbound' })));
    }).catch(() => undefined).finally(() => { if (active) refreshMessages().catch(() => setLoading(false)); });
    return () => { active = false; };
  }, [isAuthenticated, profile?.id, refreshMessages]);

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshMessages().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [isAuthenticated, profile?.id, refreshMessages]);

  const persist = useCallback((update: (current: SmsMessage[]) => SmsMessage[]) => {
    setMessages((current) => {
      const next = update(current).slice(0, 200);
      if (profile?.id) AsyncStorage.setItem(storageKey(profile.id), JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, [profile?.id]);

  const sendMessage = useCallback(async (to: string, text: string, contactName?: string, transport: 'sms' | 'internal' = 'sms') => {
    const normalized = to.replace(/[\s()-]/g, '');
    const body = text.trim();
    if (transport === 'sms' && !e164.test(normalized)) throw new Error('Use a complete international number beginning with +.');
    if (transport === 'internal' && !/^\d{2,5}$/.test(normalized)) throw new Error('Use a valid company extension.');
    if (!body) throw new Error('Write a message before sending.');
    if (body.length > 1600) throw new Error('Messages can contain up to 1,600 characters.');
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const destination = transport === 'internal' ? `extension:${normalized}` : normalized;
    const draft: SmsMessage = { id: localId, to: destination, contactName, text: body, status: 'sending', direction: 'outbound', transport, createdAt: new Date().toISOString() };
    persist((current) => [draft, ...current]);
    try {
      const sender = callerNumbers.find((number) => number.source === 'owned' && number.messaging_enabled);
      if (transport === 'sms' && !sender) throw new Error('External SMS needs an SMS-enabled number assigned by your administrator. You can still message company extensions.');
      const result = await api.post<{ id: string; status?: string; created_at?: string }>('/api/telnyx/messages', transport === 'internal'
        ? { to_extension: normalized, text: body }
        : { to: normalized, text: body, from: sender?.phone_number });
      persist((current) => current.map((message) => message.id === localId ? { ...message, id: result.id || localId, status: 'sent', createdAt: result.created_at || message.createdAt } : message));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Message could not be sent.';
      persist((current) => current.map((message) => message.id === localId ? { ...message, status: 'failed', error: reason } : message));
      throw error;
    }
  }, [callerNumbers, persist]);

  const suggestReplies = useCallback(async (input: { draft: string; recipient: string; companyName?: string; tone?: string; context?: string[] }) => {
    const result = await api.post<{ suggestions: string[] }>('/api/ai/replies', {
      draft: input.draft,
      recipient: input.recipient,
      company_name: input.companyName,
      tone: input.tone,
      context: input.context,
    });
    return result.suggestions ?? [];
  }, []);

  const value = useMemo(() => ({ messages, loading, refreshMessages, sendMessage, suggestReplies }), [loading, messages, refreshMessages, sendMessage, suggestReplies]);
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging() {
  const value = useContext(MessagingContext);
  if (!value) throw new Error('useMessaging must be used inside MessagingProvider');
  return value;
}
