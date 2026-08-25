import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import type { SmsMessage } from '../types';

type MessagingContextValue = {
  messages: SmsMessage[];
  loading: boolean;
  refreshMessages: () => Promise<void>;
  sendMessage: (to: string, text: string, contactName?: string) => Promise<void>;
  suggestReplies: (input: { draft: string; recipient: string; companyName?: string; tone?: string; context?: string[] }) => Promise<string[]>;
};

const storageKey = 'vocivo.messages.v1';
const MessagingContext = createContext<MessagingContextValue | null>(null);
const e164 = /^\+[1-9]\d{6,14}$/;

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMessages = useCallback(async () => {
    try {
      const result = await api.get<{ messages: SmsMessage[] }>('/api/telnyx/messages');
      setMessages((current) => {
        const localPending = current.filter((message) => message.id.startsWith('local-') || message.status === 'failed');
        const remote = (result.messages ?? []).map((message) => ({ ...message, direction: message.direction ?? 'outbound' as const }));
        const merged = [...localPending, ...remote].filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index).slice(0, 200);
        AsyncStorage.setItem(storageKey, JSON.stringify(merged)).catch(() => undefined);
        return merged;
      });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((value) => {
      if (value) setMessages((JSON.parse(value) as SmsMessage[]).map((message) => ({ ...message, direction: message.direction ?? 'outbound' })));
    }).catch(() => undefined).finally(() => refreshMessages().catch(() => setLoading(false)));
  }, [refreshMessages]);

  const persist = useCallback((update: (current: SmsMessage[]) => SmsMessage[]) => {
    setMessages((current) => {
      const next = update(current).slice(0, 200);
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const sendMessage = useCallback(async (to: string, text: string, contactName?: string) => {
    const normalized = to.replace(/[\s()-]/g, '');
    const body = text.trim();
    if (!e164.test(normalized)) throw new Error('Use a complete international number beginning with +.');
    if (!body) throw new Error('Write a message before sending.');
    if (body.length > 1600) throw new Error('Messages can contain up to 1,600 characters.');
    const localId = `local-${Date.now()}`;
    const draft: SmsMessage = { id: localId, to: normalized, contactName, text: body, status: 'sending', direction: 'outbound', createdAt: new Date().toISOString() };
    persist((current) => [draft, ...current]);
    try {
      const result = await api.post<{ id: string; status?: string; created_at?: string }>('/api/telnyx/messages', { to: normalized, text: body });
      persist((current) => current.map((message) => message.id === localId ? { ...message, id: result.id || localId, status: 'sent', createdAt: result.created_at || message.createdAt } : message));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Message could not be sent.';
      persist((current) => current.map((message) => message.id === localId ? { ...message, status: 'failed', error: reason } : message));
      throw error;
    }
  }, [persist]);

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
