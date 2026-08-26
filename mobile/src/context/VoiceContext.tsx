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
  pushRegistration: 'not_required' | 'registering' | 'registered' | 'unavailable';
  refreshIncomingCalls: () => Promise<void>;
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

const createRouteId = () => `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 10)}`;

const outboundHeaders = (destination: string, callerNumber: string | undefined, flow: string, routeId: string, routeToken: string) => [
  { name: 'X-Vocivo-Flow', value: flow },
  { name: 'X-Vocivo-Destination', value: destination },
  { name: 'X-Vocivo-Route-ID', value: routeId },
  { name: 'X-Vocivo-Route-Token', value: routeToken },
  ...(callerNumber ? [{ name: 'X-Vocivo-Caller-ID', value: callerNumber }] : []),
];

function inviteHeader(call: Call, name: string) {
  return call.inviteCustomHeaders?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value?.trim();
}

function visibleCallAddress(value: string) {
  return /^sip:/i.test(value) ? 'Internal call' : value;
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated, isPreview, addHistory, profile } = useAuth();
  const [connection, setConnection] = useState(voipClient.currentConnectionState);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [waitingCall, setWaitingCall] = useState<ActiveCall | null>(null);
  const [heldCall, setHeldCall] = useState<ActiveCall | null>(null);
  const [conference, setConference] = useState<MergedConference | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pushRegistration, setPushRegistration] = useState<VoiceContextValue['pushRegistration']>(Platform.OS === 'ios' ? 'registering' : 'not_required');
  const callRef = useRef<Call | null>(null);
  const callMetaRef = useRef(new Map<string, Partial<ActiveCall>>());
  const callRouteIdsRef = useRef(new Map<string, string>());
  const conferenceCallIdsRef = useRef<string[]>([]);
  const multiCallBusyRef = useRef(false);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const durationRef = useRef(0);
  const loggedCalls = useRef(new Set<string>());
  const callSubscriptions = useRef<Array<{ unsubscribe: () => void }>>([]);
  const routePollGenerationRef = useRef(0);
  const loginConfigRef = useRef<{ sipUser: string; sipPassword: string; ringtone: string } | null>(null);

  // Telnyx streams ringback into the parked call leg. Keeping Expo Audio out of
  // an active call also leaves the iOS WebRTC/CallKit audio session authoritative.
  const startRingback = useCallback(() => undefined, []);
  const stopRingback = useCallback(() => undefined, []);

  const clearCallSubscriptions = useCallback(() => {
    callSubscriptions.current.forEach((subscription) => subscription.unsubscribe());
    callSubscriptions.current = [];
  }, []);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const describeCall = useCallback((call: Call): ActiveCall => {
    const meta = callMetaRef.current.get(call.callId) ?? {};
    const displayMatch = call.callerName?.trim().match(/^(.+?)\s*-\s*Ext(?:ension)?\s+(\d{2,5})$/i);
    const internalExtension = inviteHeader(call, 'X-Vocivo-Caller-Extension') || displayMatch?.[2];
    const internalName = inviteHeader(call, 'X-Vocivo-Caller-Name') || displayMatch?.[1];
    const isInternal = Boolean(internalExtension || inviteHeader(call, 'X-Vocivo-Call-Type') === 'internal' || meta.destinationCountry === 'Internal');
    const fallbackNumber = call.isIncoming ? call.callerNumber : call.destination;
    const fallbackName = call.callerName && !/^sip:/i.test(call.callerName) ? call.callerName : visibleCallAddress(call.destination);
    return {
      id: call.callId,
      number: meta.number || internalExtension || visibleCallAddress(fallbackNumber),
      displayName: meta.displayName || internalName || fallbackName,
      destinationCountry: meta.destinationCountry || (isInternal ? 'Internal' : undefined),
      countryCode: meta.countryCode,
      ratePerMinute: meta.ratePerMinute,
      phase: meta.routeId && !meta.connectedAt ? 'ringing' : toPhase(call.currentState),
      startedAt: meta.startedAt || Date.now(),
      connectedAt: meta.connectedAt,
      muted: call.currentIsMuted,
      speaker: false,
      onHold: call.currentIsHeld,
      isIncoming: call.isIncoming,
      photoUrl: meta.photoUrl,
      routeId: meta.routeId,
      callerId: meta.callerId,
    };
  }, []);

  const finalizeCall = useCallback((phase: 'ended' | 'failed', callId?: string) => {
    const current = activeCallRef.current;
    const id = callId || current?.id || '';
    const nativeCall = id ? voipClient.getCall(id) : undefined;
    const meta = id ? callMetaRef.current.get(id) : undefined;
    const described = nativeCall ? describeCall(nativeCall) : null;
    const snapshot = current?.id === id ? current : described ? { ...described, ...meta, id } : null;
    if (!snapshot || !id) return;
    if (loggedCalls.current.has(id)) return;
    loggedCalls.current.add(id);
    const seconds = current?.id === id
      ? durationRef.current
      : nativeCall?.currentDuration ?? (snapshot.connectedAt ? Math.max(0, Math.floor((Date.now() - snapshot.connectedAt) / 1000)) : 0);
    const totalCost = snapshot.ratePerMinute ? Math.ceil(seconds / 60) * snapshot.ratePerMinute : 0;
    addHistory({
      id,
      destination_number: snapshot.number,
      destination_name: snapshot.displayName !== snapshot.destinationCountry ? snapshot.displayName : undefined,
      destination_country: snapshot.destinationCountry,
      duration_seconds: seconds,
      total_cost: Number(totalCost.toFixed(4)),
      status: phase === 'ended' && Boolean(snapshot.connectedAt) ? 'completed' : snapshot.isIncoming ? 'missed' : 'no_answer',
      started_at: new Date(snapshot.startedAt).toISOString(),
    }).catch(() => undefined);
  }, [addHistory, describeCall]);

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
      const next = { ...base, speaker: existing?.speaker ?? base.speaker };
      activeCallRef.current = next;
      return next;
    });
    durationRef.current = call.currentDuration;
    setDuration(call.currentDuration);

    callSubscriptions.current = [
      call.callState$.subscribe((state) => {
        const pendingRoute = callRouteIdsRef.current.has(call.callId) && !callMetaRef.current.get(call.callId)?.connectedAt;
        const phase = pendingRoute && [TelnyxCallState.CONNECTING, TelnyxCallState.RINGING, TelnyxCallState.ACTIVE].includes(state) ? 'ringing' : toPhase(state);
        setActiveCall((current) => {
          const next = current ? { ...current, phase, connectedAt: phase === 'active' ? (current.connectedAt ?? Date.now()) : current.connectedAt } : current;
          activeCallRef.current = next;
          return next;
        });
        if (phase === 'ended' || phase === 'failed') {
          routePollGenerationRef.current += 1;
          stopRingback();
          finalizeCall(phase, call.callId);
          callRouteIdsRef.current.delete(call.callId);
          callMetaRef.current.delete(call.callId);
          setTimeout(() => {
            const remaining = voipClient.currentCalls.find((candidate) => candidate.callId !== call.callId && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(candidate.currentState));
            if (!remaining) {
              attachCall(null);
              return;
            }
            if (remaining.currentState === TelnyxCallState.HELD) remaining.resume().catch(() => undefined);
            voipClient.setActiveCall(remaining.callId);
            attachCall(remaining);
          }, 200);
        }
      }),
      call.isMuted$.subscribe((muted) => setActiveCall((current) => current ? { ...current, muted } : current)),
      call.isHeld$.subscribe((onHold) => setActiveCall((current) => current ? { ...current, onHold } : current)),
      call.duration$.subscribe((seconds) => {
        if (callRouteIdsRef.current.has(call.callId)) return;
        durationRef.current = seconds;
        setDuration(seconds);
      }),
    ];
  }, [clearCallSubscriptions, describeCall, finalizeCall, stopRingback]);

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
    if (voipClient.currentActiveCall) attachCall(voipClient.currentActiveCall);
    return () => {
      connectionSubscription.unsubscribe();
      callsSubscription.unsubscribe();
      callSubscription.unsubscribe();
      clearCallSubscriptions();
    };
  }, [attachCall, clearCallSubscriptions, describeCall]);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || isPreview) {
      voipClient.logout().catch(() => undefined);
      setPushRegistration(Platform.OS === 'ios' ? 'unavailable' : 'not_required');
      return;
    }
    let canceled = false;
    let tokenTimer: ReturnType<typeof setInterval> | undefined;
    const connect = async () => {
      try {
        const launchedFromPush = await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (launchedFromPush || canceled) {
          if (launchedFromPush && Platform.OS === 'ios') setPushRegistration('registered');
          return;
        }
        const data = await api.get<{ sip_user: string; sip_password: string }>('/api/telnyx/config');
        if (!data.sip_user || !data.sip_password) throw new Error('Calling credentials were not returned.');
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        loginConfigRef.current = { sipUser: data.sip_user, sipPassword: data.sip_password, ringtone };
        const pushNotificationDeviceToken = Platform.OS === 'ios' ? (await VoicePnBridge.getVoipToken())?.trim() || undefined : undefined;
        const login = async (token?: string) => {
          let lastError: unknown;
          for (let attempt = 0; attempt < 3 && !canceled; attempt += 1) {
            try {
              await voipClient.login(createCredentialConfig(data.sip_user, data.sip_password, {
                debug: __DEV__,
                pushNotificationDeviceToken: token,
                pushWhenActive: true,
                enableMissedCallNotifications: true,
                incomingCallRingtone: ringtone,
                useTrickleIce: true,
              }));
              return;
            } catch (loginError) {
              lastError = loginError;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
          throw lastError instanceof Error ? lastError : new Error('Unable to connect to calling service.');
        };
        await login(pushNotificationDeviceToken);
        if (Platform.OS === 'ios') setPushRegistration(pushNotificationDeviceToken ? 'registered' : 'registering');
        if (Platform.OS === 'ios' && !pushNotificationDeviceToken) {
          tokenTimer = setInterval(() => {
            VoicePnBridge.getVoipToken().then(async (token) => {
              const value = token?.trim();
              if (!value || canceled) return;
              if (tokenTimer) clearInterval(tokenTimer);
              tokenTimer = undefined;
              setPushRegistration('registering');
              await login(value);
              if (!canceled) setPushRegistration('registered');
            }).catch(() => undefined);
          }, 2000);
        }
      } catch (voiceError) {
        if (Platform.OS === 'ios') setPushRegistration('unavailable');
        if (!canceled) setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
      }
    };
    connect();
    return () => { canceled = true; if (tokenTimer) clearInterval(tokenTimer); };
  }, [isAuthenticated, isPreview, loading]);

  const refreshIncomingCalls = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    setPushRegistration('registering');
    let data = loginConfigRef.current;
    if (!data) {
      const credentials = await api.get<{ sip_user: string; sip_password: string }>('/api/telnyx/config');
      data = { sipUser: credentials.sip_user, sipPassword: credentials.sip_password, ringtone: await loadIncomingRingtone() };
    }
    loginConfigRef.current = data;
    const token = await waitForVoipToken();
    if (!token) {
      setPushRegistration('unavailable');
      throw new Error('iPhone did not provide a VoIP push token. Allow notifications, then reopen Vocivo and try again.');
    }
    await voipClient.login(createCredentialConfig(data.sipUser, data.sipPassword, {
      debug: __DEV__, pushNotificationDeviceToken: token, pushWhenActive: true,
      enableMissedCallNotifications: true, incomingCallRingtone: data.ringtone, useTrickleIce: true,
    }));
    setPushRegistration('registered');
  }, []);

  const followRoute = useCallback(async (routeId: string, callId: string) => {
    const generation = ++routePollGenerationRef.current;
    for (let attempt = 0; attempt < 100 && routePollGenerationRef.current === generation; attempt += 1) {
      try {
        const result = await api.get<{ phase: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed'; connectedAt?: string; failureCause?: string }>(`/api/voice/status?routeId=${encodeURIComponent(routeId)}`);
        if (routePollGenerationRef.current !== generation) return;
        if (result.phase === 'connected') {
          const connectedAt = result.connectedAt ? new Date(result.connectedAt).getTime() : Date.now();
          const meta = callMetaRef.current.get(callId) ?? {};
          callMetaRef.current.set(callId, { ...meta, connectedAt });
          durationRef.current = 0;
          setDuration(0);
          setActiveCall((current) => {
            if (current?.id !== callId) return current;
            const next = { ...current, phase: 'active' as const, connectedAt };
            activeCallRef.current = next;
            return next;
          });
          stopRingback();
          return;
        }
        if (result.phase === 'failed' || result.phase === 'ended') {
          stopRingback();
          if (result.failureCause) setError(`Call ended: ${result.failureCause.replaceAll('_', ' ')}.`);
          const call = voipClient.getCall(callId);
          if (call && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) {
            await call.hangup().catch(() => undefined);
          }
          await VoicePnBridge.endCall(callId).catch(() => false);
          return;
        }
      } catch (routeError) {
        if (attempt > 8) {
          stopRingback();
          setError(routeError instanceof Error ? routeError.message : 'Call status could not be confirmed.');
          const call = voipClient.getCall(callId);
          if (call && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) {
            await call.hangup().catch(() => undefined);
          }
          await VoicePnBridge.endCall(callId).catch(() => false);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (routePollGenerationRef.current === generation) {
      stopRingback();
      setError('Call setup timed out. Please try again.');
      const call = voipClient.getCall(callId);
      if (call && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) {
        await call.hangup().catch(() => undefined);
      }
      await VoicePnBridge.endCall(callId).catch(() => false);
    }
  }, [stopRingback]);

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
    const routeId = createRouteId();
    const reservation = await api.post<{ routeId: string; routeToken: string; callerId?: string }>('/api/voice/route', { routeId, destination: number, callerId: callerNumber?.phone_number, flow: 'outbound' });
    startRingback();
    let call: Call;
    try {
      call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', reservation.callerId, outboundHeaders(number, reservation.callerId, 'outbound', routeId, reservation.routeToken));
    } catch (startError) {
      stopRingback();
      throw startError;
    }
    callRouteIdsRef.current.set(call.callId, routeId);
    callMetaRef.current.set(call.callId, { displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now(), routeId, callerId: reservation.callerId });
    attachCall(call);
    followRoute(routeId, call.callId);
    setActiveCall((current) => {
      const next = current ? { ...current, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined } : current;
      activeCallRef.current = next;
      return next;
    });
  }, [attachCall, connection, followRoute, isPreview, profile?.full_name, startRingback, stopRingback]);

  const startSecondCall = useCallback(async (number: string, rate: CallRate, callerNumber?: CallerNumber | null) => {
    if (isPreview) throw new Error('Add call requires a live calling connection.');
    if (connection !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    if (multiCallBusyRef.current) throw new Error('Another call action is still completing.');
    if (voipClient.currentCalls.some((call) => call.currentState === TelnyxCallState.HELD)) throw new Error('Resume or merge the held call before adding another caller.');
    const current = voipClient.currentActiveCall;
    if (!current || current.currentState !== TelnyxCallState.ACTIVE) throw new Error('Connect the first call before adding another caller.');
    multiCallBusyRef.current = true;
    try {
      await current.hold();
      const routeId = createRouteId();
      const reservation = await api.post<{ routeId: string; routeToken: string; callerId?: string }>('/api/voice/route', { routeId, destination: number, callerId: callerNumber?.phone_number, flow: 'outbound' });
      startRingback();
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', reservation.callerId, outboundHeaders(number, reservation.callerId, 'outbound', routeId, reservation.routeToken));
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { displayName: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now(), routeId, callerId: reservation.callerId });
      voipClient.setActiveCall(call.callId);
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (secondCallError) {
      stopRingback();
      await current.resume().catch(() => undefined);
      voipClient.setActiveCall(current.callId);
      attachCall(current);
      throw secondCallError;
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [attachCall, connection, followRoute, isPreview, profile?.full_name, startRingback, stopRingback]);

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
    const routeId = createRouteId();
    const reservation = await api.post<{ routeToken: string; callerName: string; callerExtension: string }>('/api/voice/route', { routeId, destination, flow: 'internal' });
    startRingback();
    let call: Call;
    try {
      call = await voipClient.newCall(destination, reservation.callerName || profile?.full_name || 'Vocivo', reservation.callerExtension || profile?.extension, outboundHeaders(destination, undefined, 'internal', routeId, reservation.routeToken));
    } catch (startError) {
      stopRingback();
      throw startError;
    }
    callRouteIdsRef.current.set(call.callId, routeId);
    callMetaRef.current.set(call.callId, { number: extension, displayName, destinationCountry: 'Internal', photoUrl, startedAt: Date.now(), routeId });
    attachCall(call);
    followRoute(routeId, call.callId);
  }, [attachCall, connection, followRoute, isPreview, profile?.extension, profile?.full_name, startRingback, stopRingback]);

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
    if (multiCallBusyRef.current) throw new Error('Another call action is still completing.');
    const target = voipClient.getCall(heldCall.id);
    if (!target) throw new Error('The held call is no longer available.');
    const current = voipClient.currentActiveCall;
    if (!current || current.currentState !== TelnyxCallState.ACTIVE) throw new Error('Wait for the active call to connect before swapping.');
    if (target.currentState !== TelnyxCallState.HELD) throw new Error('The other call is not on hold yet.');
    multiCallBusyRef.current = true;
    try {
      await voipClient.swapCalls(target.callId);
      voipClient.setActiveCall(target.callId);
      attachCall(target);
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [attachCall, heldCall?.id]);

  const mergeCalls = useCallback(async () => {
    if (isPreview) throw new Error('Call merge requires a live calling connection.');
    if (conferenceCallIdsRef.current.length) throw new Error('These calls are already merged.');
    if (multiCallBusyRef.current) throw new Error('Another call action is still completing.');
    const current = voipClient.currentActiveCall;
    const held = heldCall?.id ? voipClient.getCall(heldCall.id) : undefined;
    if (!current || !held || current.currentState !== TelnyxCallState.ACTIVE || held.currentState !== TelnyxCallState.HELD) {
      throw new Error('Connect the second call before merging.');
    }
    const routeIds = [current.callId, held.callId].map((id) => callRouteIdsRef.current.get(id)).filter((id): id is string => Boolean(id));
    if (routeIds.length !== 2) throw new Error('Both calls must be placed from the Vocivo dialer before they can be merged.');
    multiCallBusyRef.current = true;
    try {
      const result = await api.post<{ conferenceId: string }>('/api/voice/merge', { routeIds });
      conferenceCallIdsRef.current = [current.callId];
      setConference({ id: result.conferenceId, participants: [describeCall(current), describeCall(held)] });
      setHeldCall(null);
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [describeCall, heldCall?.id, isPreview]);

  useEffect(() => {
    if (activeCall?.phase !== 'active' || !activeCall.connectedAt) return;
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - activeCall.connectedAt!) / 1000));
      durationRef.current = seconds;
      setDuration(seconds);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeCall?.connectedAt, activeCall?.phase]);

  const endCall = useCallback(async () => {
    routePollGenerationRef.current += 1;
    stopRingback();
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
      setTimeout(() => setActiveCall(null), 200);
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
    setTimeout(() => setActiveCall(null), 200);
  }, [activeCall?.id, attachCall, finalizeCall, stopRingback]);

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

  const value = useMemo(() => ({ connection, activeCall, waitingCall, heldCall, conference, duration, error, isReady: isPreview || connection === TelnyxConnectionState.CONNECTED, pushRegistration, refreshIncomingCalls, startCall, startSecondCall, startInternalCall, transferCall, answerWaitingCall, rejectWaitingCall, swapCalls, mergeCalls, endCall, answerCall, toggleMute, toggleHold, toggleSpeaker, sendDtmf }), [activeCall, answerCall, answerWaitingCall, conference, connection, duration, endCall, error, heldCall, isPreview, mergeCalls, pushRegistration, refreshIncomingCalls, rejectWaitingCall, sendDtmf, startCall, startInternalCall, startSecondCall, swapCalls, toggleHold, toggleMute, toggleSpeaker, transferCall, waitingCall]);

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
