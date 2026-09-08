import React, { createContext, useContext, useState } from 'react';
import type { ActiveCall } from '../../src/shared/types';

const profile = { id: 'fixture', full_name: 'Alex Morgan', account_type: 'business', organization_id: 'fixture-company', organization_name: 'Northstar Studio', extension: '2000', balance: null, outbound_caller_id: '+442079460018', dialing_country: 'GB' };
const callerNumbers = [{ id: 'fixture', phone_number: '+442079460018', label: 'Studio line', source: 'owned', status: 'active' }];
const rates = [
  { id: 'ae', country_code: 'AE', country_name: 'United Arab Emirates', dial_code: '+971', rate_per_min: null },
  { id: 'gb', country_code: 'GB', country_name: 'United Kingdom', dial_code: '+44', rate_per_min: null },
];
export const useAuth = () => ({ profile, callerNumbers, rates, refresh: async () => undefined, history: [
  { id: '1', destination_number: '2001', destination_name: 'Jamie Roberts', internal: true, direction: 'incoming', status: 'completed', started_at: new Date(Date.now() - 240000).toISOString() },
  { id: '2', destination_number: '+442079460018', destination_name: 'Northstar Studio', direction: 'outgoing', status: 'completed', started_at: new Date(Date.now() - 5400000).toISOString() },
] });
const Context = createContext<any>(null);
export function FixtureProvider({ children }: { children: React.ReactNode }) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const start = async (_uri: string, number: string, name: string) => setActiveCall({ id: 'fixture-call', number, displayName: name, phase: 'active', startedAt: Date.now(), connectedAt: Date.now(), muted: false, speaker: false, onHold: false, destinationCountry: 'Internal' });
  const update = (key: 'muted' | 'speaker' | 'onHold') => setActiveCall((call) => call ? { ...call, [key]: !call[key] } : call);
  return <Context.Provider value={{ activeCall, isReady: true, duration: 12, startInternalCall: start, startCall: async (number: string, _rate: unknown, _caller: unknown, name: string) => start('', number, name || number), endCall: async () => setActiveCall(null), toggleMute: () => update('muted'), toggleHold: () => update('onHold'), toggleSpeaker: () => update('speaker'), sendDtmf: () => undefined }}>{children}</Context.Provider>;
}
export const useVoice = () => useContext(Context);
export const useBusiness = () => ({ ...useContext(Context), profile: { enabled: true, companyName: 'Northstar Studio', departments: ['Design', 'Operations'], greeting: 'Welcome to Northstar Studio.', waitingMessage: 'Please hold.', voicemailEnabled: false, voicemailDelaySeconds: 25, voicemailGreeting: '', voice: 'AWS.Polly.Joanna-Neural', backgroundImageUrl: '', aiTone: 'professional' } });
export const api = { get: async () => ({ voicemails: [], users: [
  { id: 'jamie', name: 'Jamie Roberts', extension: '2001', department: 'Design', presence: 'online' },
  { id: 'sam', name: 'Sam Lee', extension: '2002', department: 'Operations', presence: 'busy' },
  { id: 'lee', name: 'Lee Morgan', extension: '2003', department: 'Design', presence: 'offline' },
] }), post: async () => ({}) };
export const findPhoneContact = async () => null;
export const useMessaging = () => ({ messages: [], loading: false, refreshMessages: async () => undefined, sendMessage: async () => undefined, suggestReplies: async () => [] });
export const requestPermissionsAsync = async () => ({ status: 'granted' });
export const getContactsAsync = async () => ({ data: [] });
export const Fields = { PhoneNumbers: 'phoneNumbers', Image: 'image' };
export const SortTypes = { FirstName: 'firstName' };
