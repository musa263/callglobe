import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  createTelnyxVoipClient,
  createCredentialConfig,
  TelnyxCallState,
  TelnyxConnectionState,
  TelnyxVoipClient,
  TelnyxVoiceApp,
  VoicePnBridge,
  type Call,
} from '@telnyx/react-voice-commons-sdk';
import { api } from '../lib/api';
import { applyIncomingRingtone, loadIncomingRingtone } from '../lib/ringtone';
import type { ActiveCall, CallerNumber, CallPhase, CallRate, MergedConference } from '../types';
import { useAuth } from './AuthContext';

const voipClient = createTelnyxVoipClient({ enableAppStateManagement: true, debug: __DEV__, useTrickleIce: true });

type VoiceContextValue = {
  connection: TelnyxConnectionState;
  activeCall: ActiveCall | null;
  waitingCall: ActiveCall | null;
  heldCall: ActiveCall | null;
  conference: MergedConference | null;
  duration: number;
  error: string | null;
  isReady: boolean;
  startCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null, displayName?: string) => Promise<void>;
  startSecondCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null) => Promise<void>;
  startInternalCall: (sipUsername: string, extension: string, displayName: string, photoUrl?: string) => Promise<void>;
  transferCall: (targetExtensionId: string) => Promise<void>;
  answerWaitingCall: () => Promise<void>;
  rejectWaitingCall: () => Promise<void>;
  swapCalls: () => Promise<void>;
  mergeCalls: () => Promise<void>;
  endCall: () => Promise<void>;
  answerCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleHold: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  sendDtmf: (digit: string) => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

async function waitForVoipToken(): Promise<string | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const token = (await VoicePnBridge.getVoipToken())?.trim();
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

const toPhase = (state: TelnyxCallState): CallPhase => {
  if (state === TelnyxCallState.RINGING) return 'ringing';
  if (state === TelnyxCallState.CONNECTING) return 'connecting';
  if (state === TelnyxCallState.ACTIVE || state === TelnyxCallState.HELD) return 'active';
  if (state === TelnyxCallState.FAILED || state === TelnyxCallState.DROPPED) return 'failed';
  return 'ended';
};

const outboundHeaders = (destination: string, callerNumber?: string, flow = 'outbound') => [
  { name: 'X-Vocivo-Flow', value: flow },
  { name: 'X-Vocivo-Destination', value: destination },
  ...(callerNumber ? [{ name: 'X-Vocivo-Caller-ID', value: callerNumber }] : []),
];

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isPreview, addHistory } = useAuth();
  const [connection, setConnection] = useState(voipClient.currentConnectionState);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [waitingCall, setWaitingCall] = useState<ActiveCall | null>(null);
  const [heldCall, setHeldCall] = useState<ActiveCall | null>(null);
  const [conference, setConference] = useState<MergedConference | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const callRef = useRef<Call | null>(null);
  const callMetaRef = useRef(new Map<string, Partial<ActiveCall>>());
  const conferenceCallIdsRef = useRef<string[]>([]);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const durationRef = useRef(0);
  const loggedCalls = useRef(new Set<string>());
  const callSubscriptions = useRef<Array<{ unsubscribe: () => void }>>([]);

  const clearCallSubscriptions = useCallback(() => {
    callSubscriptions.current.forEach((subscription) => subscription.unsubscribe());
    callSubscriptions.current = [];
  }, []);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const describeCall = useCallback((call: Call): ActiveCall => {
    const meta = callMetaRef.current.get(call.callId) ?? {};
    return {
      id: call.callId,
      number: call.isIncoming ? call.callerNumber : call.destination,
      displayName: meta.displayName || call.callerName || call.destination,
      destinationCountry: meta.destinationCountry,
      countryCode: meta.countryCode,
      ratePerMinute: meta.ratePerMinute,
      phase: toPhase(call.currentState),
      startedAt: meta.startedAt || Date.now(),
      connectedAt: meta.connectedAt,
      muted: call.currentIsMuted,
      speaker: false,
      onHold: call.currentIsHeld,
      isIncoming: call.isIncoming,
      photoUrl: meta.photoUrl,
    };
  }, []);

  const finalizeCall = useCallback((phase: 'ended' | 'failed', callId?: string) => {
    const snapshot = activeCallRef.current;
    if (!snapshot) return;
    const id = callId || snapshot.id || String(snapshot.startedAt);
    if (loggedCalls.current.has(id)) return;
    loggedCalls.current.add(id);
    const seconds = durationRef.current;
    const totalCost = snapshot.ratePerMinute ? Math.ceil(seconds / 60) * snapshot.ratePerMinute : 0;
    addHistory({
      id,
      destination_number: snapshot.number,
      destination_name: snapshot.displayName !== snapshot.destinationCountry ? snapshot.displayName : undefined,
      destination_country: snapshot.destinationCountry,
      duration_seconds: seconds,
      total_cost: Number(totalCost.toFixed(4)),
      status: phase === 'ended' ? 'completed' : 'failed',
      started_at: new Date(snapshot.startedAt).toISOString(),
    }).catch(() => undefined);
  }, [addHistory]);

  const attachCall = useCallback((call: Call | null) => {
    clearCallSubscriptions();
    callRef.current = call;
    if (!call) {
      activeCallRef.current = null;
      durationRef.current = 0;
      setActiveCall(null);
      setDuration(0);
      return;
    }

    const base = describeCall(call);
    if (!callMetaRef.current.has(call.callId)) callMetaRef.current.set(call.callId, { startedAt: base.startedAt, connectedAt: base.connectedAt });
    setActiveCall((existing) => {
      const next = { ...base, ...existing, id: base.id, phase: base.phase };
      activeCallRef.current = next;
      return next;
    });
    durationRef.current = call.currentDuration;
    setDuration(call.currentDuration);

    callSubscriptions.current = [
      call.callState$.subscribe((state) => {
        const phase = toPhase(state);
        setActiveCall((current) => {
          const next = current ? { ...current, phase, connectedAt: phase === 'active' ? (current.connectedAt ?? Date.now()) : current.connectedAt } : current;
          activeCallRef.current = next;
          return next;
        });
        if (phase === 'ended' || phase === 'failed') {
          finalizeCall(phase, call.callId);
          setTimeout(() => {
            const remaining = voipClient.currentCalls.find((candidate) => candidate.callId !== call.callId && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(candidate.currentState));
            if (!remaining) {
              attachCall(null);
              return;
            }
            if (remaining.currentState === TelnyxCallState.HELD) remaining.resume().catch(() => undefined);
            voipClient.setActiveCall(remaining.callId);
            attachCall(remaining);
          }, 900);
        }
      }),
      call.isMuted$.subscribe((muted) => setActiveCall((current) => current ? { ...current, muted } : current)),
      call.isHeld$.subscribe((onHold) => setActiveCall((current) => current ? { ...current, onHold } : current)),
      call.duration$.subscribe((seconds) => { durationRef.current = seconds; setDuration(seconds); }),
    ];
  }, [clearCallSubscriptions, describeCall, finalizeCall]);

  useEffect(() => {
    const connectionSubscription = voipClient.connectionState$.subscribe(setConnection);
    const callsSubscription = voipClient.calls$.subscribe((calls) => {
      const currentId = voipClient.currentActiveCall?.callId;
      const waiting = calls.find((call) => call.callId !== currentId && call.isIncoming && call.currentState === TelnyxCallState.RINGING);
      const held = calls.find((call) => call.callId !== currentId && call.currentState === TelnyxCallState.HELD);
      setWaitingCall(waiting ? describeCall(waiting) : null);
      const mergedCalls = conferenceCallIdsRef.current
        .map((id) => calls.find((call) => call.callId === id))
        .filter((call): call is Call => Boolean(call && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)));
      if (conferenceCallIdsRef.current.length && mergedCalls.length >= 1) {
        setHeldCall(null);
      } else {
        if (conferenceCallIdsRef.current.length) {
          conferenceCallIdsRef.current = [];
          setConference(null);
        }
        setHeldCall(held ? describeCall(held) : null);
      }
    });
    const callSubscription = voipClient.activeCall$.subscribe(attachCall);
    return () => {
      connectionSubscription.unsubscribe();
      callsSubscription.unsubscribe();
      callSubscription.unsubscribe();
      clearCallSubscriptions();
    };
  }, [attachCall, clearCallSubscriptions, describeCall]);

  useEffect(() => {
    if (!isAuthenticated || isPreview) return;
    let canceled = false;
    const connect = async () => {
      try {
        const launchedFromPush = await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (launchedFromPush || canceled) return;
        const data = await api.get<{ sip_user: string; sip_password: string }>('/api/telnyx/config');
        if (!data.sip_user || !data.sip_password) throw new Error('Calling credentials were not returned.');
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        const pushNotificationDeviceToken = await waitForVoipToken();
        await voipClient.login(createCredentialConfig(data.sip_user, data.sip_password, {
          debug: __DEV__,
          pushNotificationDeviceToken,
          pushWhenActive: true,
          enableMissedCallNotifications: true,
          incomingCallRingtone: ringtone,
          useTrickleIce: true,
        }));
      } catch (voiceError) {
        if (!canceled) setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
      }
    };
    connect();
    return () => { canceled = true; };
  }, [isAuthenticated, isPreview]);

  const startCall = useCallback(async (number: string, rate: CallRate, callerNumber?: CallerNumber | null, displayName?: string) => {
    setError(null);
    if (isPreview) {
      const previewCall: ActiveCall = { number, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, phase: 'connecting', startedAt: Date.now(), muted: false, speaker: false, onHold: false };
      activeCallRef.current = previewCall;
      setActiveCall(previewCall);
      setTimeout(() => setActiveCall((current) => current ? { ...current, phase: 'ringing' } : null), 650);
      setTimeout(() => setActiveCall((current) => current ? { ...current, phase: 'active', connectedAt: Date.now() } : null), 1700);
      return;
    }
    if (connection !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const call = await voipClient.newCall(number, displayName || 'Vocivo', callerNumber?.phone_number, outboundHeaders(number, callerNumber?.phone_number));
    callMetaRef.current.set(call.callId, { displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now() });
    attachCall(call);
    setActiveCall((current) => {
      const next = current ? { ...current, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined } : current;
      activeCallRef.current = next;
      return next;
    });
  }, [attachCall, connection, isPreview]);

  const startSecondCall = useCallback(async (number: string, rate: CallRate, callerNumber?: CallerNumber | null) => {
    if (isPreview) throw new Error('Add call requires a live calling connection.');
    if (connection !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const current = voipClient.currentActiveCall;
    if (!current || current.currentState !== TelnyxCallState.ACTIVE) throw new Error('Connect the first call before adding another caller.');
    await current.hold();
    try {
      const call = await voipClient.newCall(number, 'Vocivo', callerNumber?.phone_number, outboundHeaders(number, callerNumber?.phone_number));
      callMetaRef.current.set(call.callId, { displayName: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now() });
      voipClient.setActiveCall(call.callId);
      attachCall(call);
    } catch (secondCallError) {
      await current.resume().catch(() => undefined);
      throw secondCallError;
    }
  }, [attachCall, connection, isPreview]);

  const startInternalCall = useCallback(async (sipUsername: string, extension: string, displayName: string, photoUrl?: string) => {
    setError(null);
    if (isPreview) {
      const previewCall: ActiveCall = { number: extension, displayName, destinationCountry: 'Internal', photoUrl, phase: 'connecting', startedAt: Date.now(), muted: false, speaker: false, onHold: false };
      activeCallRef.current = previewCall;
      setActiveCall(previewCall);
      setTimeout(() => setActiveCall((current) => current ? { ...current, phase: 'active', connectedAt: Date.now() } : null), 900);
      return;
    }
    if (connection !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const destination = `sip:${sipUsername}@sip.telnyx.com`;
    const call = await voipClient.newCall(destination, displayName, undefined, outboundHeaders(destination, undefined, 'internal'));
    callMetaRef.current.set(call.callId, { displayName, destinationCountry: 'Internal', photoUrl, startedAt: Date.now() });
    attachCall(call);
  }, [attachCall, connection, isPreview]);

  const transferCall = useCallback(async (targetExtensionId: string) => {
    if (isPreview) throw new Error('Transfer requires a live routed business call.');
    await api.post('/api/voice/transfer', { targetExtensionId });
  }, [isPreview]);

  const answerWaitingCall = useCallback(async () => {
    if (!waitingCall?.id) return;
    const incoming = voipClient.getCall(waitingCall.id);
    const current = voipClient.currentActiveCall;
    if (!incoming) return;
    if (current && current.callId !== incoming.callId && current.currentState === TelnyxCallState.ACTIVE) await current.hold();
    await incoming.answer();
    voipClient.setActiveCall(incoming.callId);
    attachCall(incoming);
  }, [attachCall, waitingCall?.id]);

  const rejectWaitingCall = useCallback(async () => {
    if (!waitingCall?.id) return;
    await voipClient.getCall(waitingCall.id)?.hangup();
  }, [waitingCall?.id]);

  const swapCalls = useCallback(async () => {
    if (!heldCall?.id) throw new Error('There is no held call to swap.');
    await voipClient.swapCalls(heldCall.id);
  }, [heldCall?.id]);

  const mergeCalls = useCallback(async () => {
    if (isPreview) throw new Error('Call merge requires a live calling connection.');
    if (conferenceCallIdsRef.current.length) throw new Error('These calls are already merged.');
    const current = voipClient.currentActiveCall;
    const held = heldCall?.id ? voipClient.getCall(heldCall.id) : undefined;
    if (!current || !held || current.currentState !== TelnyxCallState.ACTIVE || held.currentState !== TelnyxCallState.HELD) {
      throw new Error('Connect the second call before merging.');
    }
    const callControlIds = [current, held]
      .map((call) => call.telnyxCall.telnyxCallControlId?.trim())
      .filter((id): id is string => Boolean(id));
    if (callControlIds.length !== 2) throw new Error('Telnyx is still preparing the call legs. Wait a moment and try again.');

    const result = await api.post<{ conferenceId: string }>('/api/voice/merge', { callControlIds });
    conferenceCallIdsRef.current = [current.callId];
    setConference({ id: result.conferenceId, participants: [describeCall(current), describeCall(held)] });
    setHeldCall(null);
  }, [describeCall, heldCall?.id, isPreview]);

  useEffect(() => {
    if (!isPreview || activeCall?.phase !== 'active') return;
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [activeCall?.phase, isPreview]);

  const endCall = useCallback(async () => {
    if (conferenceCallIdsRef.current.length) {
      const mergedIds = [...conferenceCallIdsRef.current];
      const mergedCalls = mergedIds.map((id) => voipClient.getCall(id)).filter((call): call is Call => Boolean(call));
      conferenceCallIdsRef.current = [];
      setConference(null);
      setHeldCall(null);
      finalizeCall('ended', activeCall?.id);
      await Promise.all(mergedCalls.map((call) => call.hangup().catch(() => undefined)));
      await Promise.all(mergedIds.map((id) => VoicePnBridge.endCall(id).catch(() => false)));
      setActiveCall((current) => current ? { ...current, phase: 'ended' } : current);
      setTimeout(() => setActiveCall(null), 650);
      return;
    }
    const resumeAfterEnd = voipClient.currentCalls.find((call) => call.callId !== callRef.current?.callId && call.currentState === TelnyxCallState.HELD);
    finalizeCall('ended', activeCall?.id);
    if (callRef.current) await callRef.current.hangup();
    if (activeCall?.id) await VoicePnBridge.endCall(activeCall.id).catch(() => false);
    if (resumeAfterEnd) {
      await resumeAfterEnd.resume().catch(() => undefined);
      voipClient.setActiveCall(resumeAfterEnd.callId);
      attachCall(resumeAfterEnd);
      return;
    }
    setActiveCall((current) => current ? { ...current, phase: 'ended' } : current);
    setTimeout(() => setActiveCall(null), 650);
  }, [activeCall?.id, attachCall, finalizeCall]);

  const answerCall = useCallback(async () => { if (callRef.current) await callRef.current.answer(); }, []);
  const toggleMute = useCallback(async () => {
    if (callRef.current) await callRef.current.toggleMute();
    else setActiveCall((current) => current ? { ...current, muted: !current.muted } : current);
  }, []);
  const toggleHold = useCallback(async () => {
    if (callRef.current) callRef.current.currentIsHeld ? await callRef.current.resume() : await callRef.current.hold();
    else setActiveCall((current) => current ? { ...current, onHold: !current.onHold } : current);
  }, []);
  const toggleSpeaker = useCallback(async () => {
    const speaker = await VoicePnBridge.toggleSpeaker().catch(() => !activeCall?.speaker);
    setActiveCall((current) => current ? { ...current, speaker } : current);
  }, [activeCall?.speaker]);
  const sendDtmf = useCallback(async (digit: string) => { if (callRef.current) await callRef.current.dtmf(digit); }, []);

  const value = useMemo(() => ({ connection, activeCall, waitingCall, heldCall, conference, duration, error, isReady: isPreview || connection === TelnyxConnectionState.CONNECTED, startCall, startSecondCall, startInternalCall, transferCall, answerWaitingCall, rejectWaitingCall, swapCalls, mergeCalls, endCall, answerCall, toggleMute, toggleHold, toggleSpeaker, sendDtmf }), [activeCall, answerCall, answerWaitingCall, conference, connection, duration, endCall, error, heldCall, isPreview, mergeCalls, rejectWaitingCall, sendDtmf, startCall, startInternalCall, startSecondCall, swapCalls, toggleHold, toggleMute, toggleSpeaker, transferCall, waitingCall]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function VoiceRoot({ children }: { children: React.ReactNode }) {
  return <TelnyxVoiceApp voipClient={voipClient} enableAutoReconnect debug={__DEV__}><VoiceProvider>{children}</VoiceProvider></TelnyxVoiceApp>;
}

export function useVoice() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('useVoice must be used inside VoiceRoot');
  return value;
}
