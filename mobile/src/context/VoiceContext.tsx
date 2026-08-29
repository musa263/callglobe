import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  createTokenConfig,
  TelnyxCallState,
  TelnyxConnectionState,
  TelnyxVoipClient,
  TelnyxVoiceApp,
  VoicePnBridge,
  type Call,
} from '@telnyx/react-voice-commons-sdk';
import { api } from '../lib/api';
import { applyIncomingRingtone, loadIncomingRingtone } from '../lib/ringtone';
import { getVoicePushToken, voipClient } from '../lib/voipClient';
import { CallLifecycleRegistry, isTerminalCallState, type CallLifecycleState } from '../lib/callLifecycle';
import type { ActiveCall, CallerNumber, CallPhase, CallRate, MergedConference } from '../types';
import { useAuth } from './AuthContext';

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
  startCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null, displayName?: string, photoUrl?: string) => Promise<void>;
  startSecondCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null) => Promise<void>;
  startInternalCall: (sipUsername: string, extension: string, displayName: string, photoUrl?: string) => Promise<void>;
  transferCall: (targetExtensionId: string) => Promise<void>;
  answerWaitingCall: () => Promise<void>;
  rejectWaitingCall: () => Promise<void>;
  swapCalls: () => Promise<void>;
  mergeCalls: () => Promise<void>;
  removeConferenceParticipant: (participantId: string) => Promise<void>;
  endCall: () => Promise<void>;
  answerCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleHold: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  sendDtmf: (digit: string) => Promise<void>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

type VoiceIceServer = { urls: string | string[]; username?: string; credential?: string };
type VoiceTokenResponse = { token: string; expires_in?: number; ice_servers?: VoiceIceServer[] };
type VoiceLoginConfig = { token: string; expiresAt: number; iceServers?: VoiceIceServer[]; ringtone: string };

function voiceLoginConfig(response: VoiceTokenResponse, ringtone: string): VoiceLoginConfig {
  if (!response.token?.trim()) throw new Error('A calling session token was not returned.');
  const requestedLifetime = Number(response.expires_in || 3600);
  const lifetimeSeconds = Number.isFinite(requestedLifetime) ? Math.max(60, requestedLifetime) : 3600;
  const iceServers = Array.isArray(response.ice_servers) && response.ice_servers.length
    ? response.ice_servers
    : undefined;
  return { token: response.token.trim(), expiresAt: Date.now() + lifetimeSeconds * 1000, iceServers, ringtone };
}

async function waitForVoicePushToken(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const token = await getVoicePushToken();
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

const toLifecycleState = (state: TelnyxCallState): CallLifecycleState => {
  if (state === TelnyxCallState.CONNECTING) return 'CONNECTING';
  if (state === TelnyxCallState.RINGING) return 'RINGING';
  if (state === TelnyxCallState.ACTIVE) return 'ACTIVE';
  if (state === TelnyxCallState.HELD) return 'HELD';
  if (state === TelnyxCallState.FAILED) return 'FAILED';
  if (state === TelnyxCallState.DROPPED) return 'DROPPED';
  return 'ENDED';
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
  const [pushRegistration, setPushRegistration] = useState<VoiceContextValue['pushRegistration']>('registering');
  const callRef = useRef<Call | null>(null);
  const callMetaRef = useRef(new Map<string, Partial<ActiveCall>>());
  const callRouteIdsRef = useRef(new Map<string, string>());
  const conferenceCallIdsRef = useRef<string[]>([]);
  const multiCallBusyRef = useRef(false);
  const startingCallRef = useRef(false);
  const startAttemptRef = useRef(0);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const durationRef = useRef(0);
  const loggedCalls = useRef(new Set<string>());
  const lifecycleRef = useRef(new CallLifecycleRegistry());
  const callSubscriptions = useRef<Array<{ unsubscribe: () => void }>>([]);
  const routePollGenerationRef = useRef(0);
  const loginConfigRef = useRef<VoiceLoginConfig | null>(null);

  // Telnyx streams ringback into the parked call leg. Keeping Expo Audio out of
  // an active call also leaves the iOS WebRTC/CallKit audio session authoritative.
  const startRingback = useCallback(() => undefined, []);
  const stopRingback = useCallback(() => undefined, []);

  const clearCallSubscriptions = useCallback(() => {
    callSubscriptions.current.forEach((subscription) => subscription.unsubscribe());
    callSubscriptions.current = [];
  }, []);

  const terminateCall = useCallback((callId: string, routeId?: string) => lifecycleRef.current.terminate(callId, async () => {
    const call = voipClient.getCall(callId);
    await Promise.all([
      ...(routeId ? [api.post('/api/voice/cancel', { routeId }).catch(() => undefined)] : []),
      call
        ? [call.hangup().catch(() => undefined)]
        : [VoicePnBridge.endCall(callId).then(() => undefined).catch(() => undefined)],
    ]);
  }), []);

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
      photoUrl: meta.photoUrl || inviteHeader(call, 'X-Vocivo-Caller-Photo') || undefined,
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
    const currentLifecycle = lifecycleRef.current.state(call.callId);
    if (isTerminalCallState(currentLifecycle)) return;
    if (lifecycleRef.current.isTerminating(call.callId) && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) {
      return;
    }
    const initialLifecycle = toLifecycleState(call.currentState);
    lifecycleRef.current.transition(call.callId, initialLifecycle);
    if (isTerminalCallState(initialLifecycle)) return;

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
        const lifecycleState = toLifecycleState(state);
        if (!lifecycleRef.current.transition(call.callId, lifecycleState)) {
          if (lifecycleRef.current.isTerminating(call.callId) && !isTerminalCallState(lifecycleState)) {
            setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'ended' } : current);
          }
          return;
        }
        if (lifecycleRef.current.isTerminating(call.callId) && !isTerminalCallState(lifecycleState)) {
          setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'ended' } : current);
          return;
        }
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
          setTimeout(() => lifecycleRef.current.release(call.callId), 60_000);
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
      lifecycleRef.current.clear();
    };
  }, [attachCall, clearCallSubscriptions, describeCall]);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || isPreview) {
      loginConfigRef.current = null;
      voipClient.logout().catch(() => undefined);
      setPushRegistration('unavailable');
      return;
    }
    let canceled = false;
    let tokenTimer: ReturnType<typeof setInterval> | undefined;
    let sessionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let activeRegistrationTimer: ReturnType<typeof setTimeout> | undefined;
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    const connect = async () => {
      try {
        const launchedFromPush = await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (launchedFromPush || canceled) {
          if (launchedFromPush && Platform.OS === 'ios') setPushRegistration('registered');
          return;
        }
        const response = await api.post<VoiceTokenResponse>('/api/telnyx/token', {});
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        const initialSession = voiceLoginConfig(response, ringtone);
        loginConfigRef.current = initialSession;
        const pushNotificationDeviceToken = await getVoicePushToken();
        let registeredToken = pushNotificationDeviceToken;
        let registrationBusy = false;
        let sessionRefreshBusy = false;
        const login = async (pushToken?: string, session = loginConfigRef.current) => {
          if (!session) throw new Error('The calling session is unavailable.');
          let lastError: unknown;
          for (let attempt = 0; attempt < 3 && !canceled; attempt += 1) {
            try {
              await voipClient.loginWithToken(createTokenConfig(session.token, {
                debug: __DEV__,
                pushNotificationDeviceToken: pushToken,
                pushWhenActive: true,
                enableMissedCallNotifications: true,
                incomingCallRingtone: ringtone,
                useTrickleIce: true,
                ...(session.iceServers ? { iceServers: session.iceServers } : {}),
              }));
              return;
            } catch (loginError) {
              lastError = loginError;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
          throw lastError instanceof Error ? lastError : new Error('Unable to connect to calling service.');
        };
        const refreshSession = async () => {
          if (canceled || sessionRefreshBusy) return;
          if (activeCallRef.current) {
            sessionRefreshTimer = setTimeout(() => { refreshSession().catch(() => undefined); }, 60_000);
            return;
          }
          sessionRefreshBusy = true;
          try {
            const fresh = voiceLoginConfig(
              await api.post<VoiceTokenResponse>('/api/telnyx/token', {}),
              ringtone,
            );
            await login(registeredToken, fresh);
            loginConfigRef.current = fresh;
            scheduleSessionRefresh(fresh);
          } catch (refreshError) {
            if (!canceled) setError(refreshError instanceof Error ? refreshError.message : 'Calling session refresh failed.');
            if (!canceled) sessionRefreshTimer = setTimeout(() => { refreshSession().catch(() => undefined); }, 60_000);
          } finally {
            sessionRefreshBusy = false;
          }
        };
        const scheduleSessionRefresh = (session: VoiceLoginConfig) => {
          if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
          const delay = Math.max(60_000, session.expiresAt - Date.now() - 120_000);
          sessionRefreshTimer = setTimeout(() => { refreshSession().catch(() => undefined); }, delay);
        };
        const registerLatestDevice = async () => {
          if (canceled || registrationBusy) return;
          const token = await getVoicePushToken();
          if (!token || token === registeredToken) return;
          registrationBusy = true;
          setPushRegistration('registering');
          try {
            await login(token);
            registeredToken = token;
            if (!canceled) setPushRegistration('registered');
          } catch {
            if (!canceled) setPushRegistration('unavailable');
          } finally {
            registrationBusy = false;
          }
        };
        await login(pushNotificationDeviceToken);
        scheduleSessionRefresh(initialSession);
        setPushRegistration(pushNotificationDeviceToken ? 'registered' : 'registering');
        if (!pushNotificationDeviceToken) {
          tokenTimer = setInterval(() => {
            registerLatestDevice().then(() => {
              if (!registeredToken || !tokenTimer) return;
              clearInterval(tokenTimer);
              tokenTimer = undefined;
            }).catch(() => undefined);
          }, 2000);
        }
        appStateSubscription = AppState.addEventListener('change', (state) => {
          if (state !== 'active' || canceled) return;
          if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
          activeRegistrationTimer = setTimeout(() => registerLatestDevice().catch(() => undefined), 750);
        });
      } catch (voiceError) {
        setPushRegistration('unavailable');
        if (!canceled) setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
      }
    };
    connect();
    return () => {
      canceled = true;
      if (tokenTimer) clearInterval(tokenTimer);
      if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
      if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
      appStateSubscription?.remove();
    };
  }, [isAuthenticated, isPreview, loading]);

  const refreshIncomingCalls = useCallback(async () => {
    setPushRegistration('registering');
    let data = loginConfigRef.current;
    if (!data || data.expiresAt <= Date.now() + 60_000) {
      const session = await api.post<VoiceTokenResponse>('/api/telnyx/token', {});
      data = voiceLoginConfig(session, await loadIncomingRingtone());
    }
    loginConfigRef.current = data;
    const pushToken = await waitForVoicePushToken();
    if (!pushToken) {
      setPushRegistration('unavailable');
      throw new Error(`${Platform.OS === 'ios' ? 'iPhone' : 'Android'} did not provide a push token. Allow notifications, then reopen Vocivo and try again.`);
    }
    await voipClient.loginWithToken(createTokenConfig(data.token, {
      debug: __DEV__, pushNotificationDeviceToken: pushToken, pushWhenActive: true,
      enableMissedCallNotifications: true, incomingCallRingtone: data.ringtone, useTrickleIce: true,
      ...(data.iceServers ? { iceServers: data.iceServers } : {}),
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
          await terminateCall(callId, routeId);
          return;
        }
      } catch (routeError) {
        if (attempt > 8) {
          stopRingback();
          setError(routeError instanceof Error ? routeError.message : 'Call status could not be confirmed.');
          await terminateCall(callId, routeId);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (routePollGenerationRef.current === generation) {
      stopRingback();
      setError('Call setup timed out. Please try again.');
      await terminateCall(callId, routeId);
    }
  }, [stopRingback, terminateCall]);

  const startCall = useCallback(async (number: string, rate: CallRate, callerNumber?: CallerNumber | null, displayName?: string, photoUrl?: string) => {
    setError(null);
    if (startingCallRef.current) throw new Error('A call is already starting.');
    if (isPreview) {
      const previewCall: ActiveCall = { number, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, phase: 'connecting', startedAt: Date.now(), muted: false, speaker: false, onHold: false };
      activeCallRef.current = previewCall;
      setActiveCall(previewCall);
      setTimeout(() => setActiveCall((current) => current ? { ...current, phase: 'ringing' } : null), 650);
      setTimeout(() => setActiveCall((current) => current ? { ...current, phase: 'active', connectedAt: Date.now() } : null), 1700);
      return;
    }
    if (connection !== TelnyxConnectionState.CONNECTED) throw new Error('Call service is still connecting.');
    const routeId = createRouteId();
    const attempt = ++startAttemptRef.current;
    const startedAt = Date.now();
    const optimisticCall: ActiveCall = { number, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, phase: 'connecting', startedAt, muted: false, speaker: false, onHold: false, routeId };
    activeCallRef.current = optimisticCall;
    setActiveCall(optimisticCall);
    startingCallRef.current = true;
    try {
      const reservation = await api.post<{ routeId: string; routeToken: string; callerId?: string }>('/api/voice/route', { routeId, destination: number, callerId: callerNumber?.phone_number, flow: 'outbound' });
      if (startAttemptRef.current !== attempt) {
        await api.post('/api/voice/cancel', { routeId }).catch(() => undefined);
        return;
      }
      startRingback();
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', reservation.callerId, outboundHeaders(number, reservation.callerId, 'outbound', routeId, reservation.routeToken));
      if (startAttemptRef.current !== attempt) {
        await Promise.all([call.hangup().catch(() => undefined), api.post('/api/voice/cancel', { routeId }).catch(() => undefined)]);
        return;
      }
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, startedAt, routeId, callerId: reservation.callerId });
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (startError) {
      stopRingback();
      if (startAttemptRef.current === attempt) {
        activeCallRef.current = null;
        setActiveCall(null);
      }
      throw startError;
    } finally {
      if (startAttemptRef.current === attempt) startingCallRef.current = false;
    }
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
    if (startingCallRef.current) throw new Error('A call is already starting.');
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
    const attempt = ++startAttemptRef.current;
    const startedAt = Date.now();
    const optimisticCall: ActiveCall = { number: extension, displayName, destinationCountry: 'Internal', photoUrl, phase: 'connecting', startedAt, muted: false, speaker: false, onHold: false, routeId };
    activeCallRef.current = optimisticCall;
    setActiveCall(optimisticCall);
    startingCallRef.current = true;
    try {
      const reservation = await api.post<{ routeToken: string; callerName: string; callerExtension: string }>('/api/voice/route', { routeId, destination, flow: 'internal' });
      if (startAttemptRef.current !== attempt) {
        await api.post('/api/voice/cancel', { routeId }).catch(() => undefined);
        return;
      }
      startRingback();
      const call = await voipClient.newCall(destination, reservation.callerName || profile?.full_name || 'Vocivo', reservation.callerExtension || profile?.extension, outboundHeaders(destination, undefined, 'internal', routeId, reservation.routeToken));
      if (startAttemptRef.current !== attempt) {
        await Promise.all([call.hangup().catch(() => undefined), api.post('/api/voice/cancel', { routeId }).catch(() => undefined)]);
        return;
      }
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { number: extension, displayName, destinationCountry: 'Internal', photoUrl, startedAt, routeId });
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (startError) {
      stopRingback();
      if (startAttemptRef.current === attempt) {
        activeCallRef.current = null;
        setActiveCall(null);
      }
      throw startError;
    } finally {
      if (startAttemptRef.current === attempt) startingCallRef.current = false;
    }
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
      setConference({ id: result.conferenceId, participants: [describeCall(held), describeCall(current)] });
      setHeldCall(null);
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [describeCall, heldCall?.id, isPreview]);

  const removeConferenceParticipant = useCallback(async (participantId: string) => {
    const currentConference = conference;
    const participant = currentConference?.participants.find((item) => item.id === participantId);
    if (!currentConference || !participant?.routeId) throw new Error('This conference participant is no longer available.');
    if (participant.id === currentConference.participants[0]?.id) throw new Error('The primary caller cannot be removed while the conference is active.');
    if (multiCallBusyRef.current) throw new Error('Another call action is still completing.');
    multiCallBusyRef.current = true;
    try {
      await api.post('/api/voice/merge', {
        action: 'remove_participant',
        conferenceId: currentConference.id,
        routeId: participant.routeId,
      });
      const remaining = currentConference.participants.filter((item) => item.id !== participantId);
      const primary = remaining[0];
      const localHostId = activeCallRef.current?.id;
      if (participant.id && participant.id !== localHostId) {
        callRouteIdsRef.current.delete(participant.id);
        callMetaRef.current.delete(participant.id);
      }
      if (participant.id === localHostId && primary && localHostId) {
        if (primary.routeId) callRouteIdsRef.current.set(localHostId, primary.routeId);
        callMetaRef.current.set(localHostId, { ...primary, id: undefined });
        setActiveCall((current) => {
          if (current?.id !== localHostId) return current;
          const next = { ...current, ...primary, id: localHostId, phase: current.phase, connectedAt: current.connectedAt, onHold: false };
          activeCallRef.current = next;
          return next;
        });
      }
      setConference((current) => current?.id === currentConference.id ? { ...current, participants: remaining } : current);
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [conference]);

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
    startAttemptRef.current += 1;
    startingCallRef.current = false;
    routePollGenerationRef.current += 1;
    stopRingback();
    if (conferenceCallIdsRef.current.length) {
      const mergedIds = [...conferenceCallIdsRef.current];
      conferenceCallIdsRef.current = [];
      setConference(null);
      setHeldCall(null);
      finalizeCall('ended', activeCall?.id);
      activeCallRef.current = null;
      setActiveCall(null);
      await Promise.all(mergedIds.map((id) => terminateCall(id, callRouteIdsRef.current.get(id))));
      return;
    }
    const callId = activeCall?.id || callRef.current?.callId;
    const routeId = activeCall?.routeId || (callId ? callRouteIdsRef.current.get(callId) : undefined);
    const resumeAfterEnd = voipClient.currentCalls.find((call) => call.callId !== callRef.current?.callId && call.currentState === TelnyxCallState.HELD);
    finalizeCall('ended', callId);
    activeCallRef.current = null;
    durationRef.current = 0;
    setActiveCall(null);
    setDuration(0);
    if (callId) await terminateCall(callId, routeId);
    if (resumeAfterEnd) {
      await resumeAfterEnd.resume().catch(() => undefined);
      voipClient.setActiveCall(resumeAfterEnd.callId);
      attachCall(resumeAfterEnd);
      return;
    }
  }, [activeCall?.id, activeCall?.routeId, attachCall, finalizeCall, stopRingback, terminateCall]);

  const answerCall = useCallback(async () => {
    const call = callRef.current;
    if (!call || !call.isIncoming) return;
    if (![TelnyxCallState.RINGING, TelnyxCallState.CONNECTING].includes(call.currentState)) return;
    setError(null);
    setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'connecting' } : current);
    try {
      voipClient.setActiveCall(call.callId);
      await call.answer();
      if (Platform.OS === 'android') await VoicePnBridge.hideIncomingCallNotification();
      attachCall(call);
    } catch (answerError) {
      setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'ringing' } : current);
      setError(answerError instanceof Error ? answerError.message : 'The incoming call could not be answered.');
      throw answerError;
    }
  }, [attachCall]);
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

  const value = useMemo(() => ({ connection, activeCall, waitingCall, heldCall, conference, duration, error, isReady: isPreview || connection === TelnyxConnectionState.CONNECTED, pushRegistration, refreshIncomingCalls, startCall, startSecondCall, startInternalCall, transferCall, answerWaitingCall, rejectWaitingCall, swapCalls, mergeCalls, removeConferenceParticipant, endCall, answerCall, toggleMute, toggleHold, toggleSpeaker, sendDtmf }), [activeCall, answerCall, answerWaitingCall, conference, connection, duration, endCall, error, heldCall, isPreview, mergeCalls, pushRegistration, refreshIncomingCalls, rejectWaitingCall, removeConferenceParticipant, sendDtmf, startCall, startInternalCall, startSecondCall, swapCalls, toggleHold, toggleMute, toggleSpeaker, transferCall, waitingCall]);

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
