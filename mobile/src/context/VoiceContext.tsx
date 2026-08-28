import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  createCredentialConfig,
  TelnyxCallState,
  TelnyxConnectionState,
  TelnyxVoipClient,
  VoicePnBridge,
  getAndroidPushToken,
  onAndroidPushTokenRefresh,
  type Call,
  pushDeviceId,
} from '../lib/voipClient';
import { api } from '../lib/api';
import { applyIncomingRingtone, loadIncomingRingtone } from '../lib/ringtone';
import { voipClient } from '../lib/voipClient';
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

const outboundHeaders = (destination: string, callerNumber: string | undefined, flow: string) => [
  { name: 'X-Vocivo-Flow', value: flow },
  { name: 'X-Vocivo-Destination', value: destination },
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
  const [pushRegistration, setPushRegistration] = useState<VoiceContextValue['pushRegistration']>(Platform.OS === 'ios' || Platform.OS === 'android' ? 'registering' : 'not_required');
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
  const endingCallIdsRef = useRef(new Set<string>());
  const endCallOperationRef = useRef<Promise<void> | null>(null);
  const callSubscriptions = useRef<Array<{ unsubscribe: () => void }>>([]);
  const routePollGenerationRef = useRef(0);
  const loginConfigRef = useRef<{ sipUser: string; sipPassword: string; sipDomain: string; websocketUrl: string; extension: string; ringtone: string; iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> } | null>(null);

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
    if (endingCallIdsRef.current.has(call.callId) && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)) {
      voipClient.endCall(call.callId).catch(() => undefined);
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
        if (endingCallIdsRef.current.has(call.callId) && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(state)) {
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
          endingCallIdsRef.current.delete(call.callId);
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
    const connectionSubscription = voipClient.connectionState$.subscribe((state) => {
      setConnection(state);
      if (state === TelnyxConnectionState.CONNECTED) {
        setError((current) => current && /connect|registration|PBX/i.test(current) ? null : current);
      }
    });
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
      setPushRegistration(Platform.OS === 'ios' || Platform.OS === 'android' ? 'unavailable' : 'not_required');
      return;
    }
    let canceled = false;
    let tokenTimer: ReturnType<typeof setInterval> | undefined;
    let activeRegistrationTimer: ReturnType<typeof setTimeout> | undefined;
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    let tokenRefreshSubscription: (() => void) | undefined;
    const connect = async () => {
      try {
        if (canceled) return;
        const data = await api.get<{ provider: string; sip_user: string; sip_password: string; sip_domain: string; websocket_url: string; extension: string; ice_servers?: Array<{ urls: string | string[]; username?: string; credential?: string }> }>('/api/voice/config');
        if (data.provider !== 'freeswitch' || !data.sip_user || !data.sip_password || !data.sip_domain || !data.websocket_url) throw new Error('Calling credentials were not returned.');
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        loginConfigRef.current = { sipUser: data.sip_user, sipPassword: data.sip_password, sipDomain: data.sip_domain, websocketUrl: data.websocket_url, extension: data.extension, ringtone, iceServers: data.ice_servers };
        const readPushToken = async () => Platform.OS === 'ios'
          ? (await VoicePnBridge.getVoipToken())?.trim() || undefined
          : Platform.OS === 'android'
            ? (await getAndroidPushToken())?.trim() || undefined
            : undefined;
        const pushNotificationDeviceToken = await readPushToken();
        let registeredToken: string | undefined;
        let registrationBusy = false;
        const login = async () => {
          let lastError: unknown;
          for (let attempt = 0; attempt < 3 && !canceled; attempt += 1) {
            try {
              await voipClient.login(createCredentialConfig(data.sip_user, data.sip_password, {
                sipDomain: data.sip_domain,
                websocketUrl: data.websocket_url,
                extension: data.extension,
                displayName: profile?.full_name || undefined,
                incomingCallRingtone: ringtone,
                iceServers: data.ice_servers,
              }));
              return;
            } catch (loginError) {
              lastError = loginError;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
          throw lastError instanceof Error ? lastError : new Error('Unable to connect to calling service.');
        };
        const registerLatestDevice = async (refreshedToken?: string) => {
          if (!['ios', 'android'].includes(Platform.OS) || canceled || registrationBusy) return;
          const token = refreshedToken?.trim() || await readPushToken();
          if (!token || token === registeredToken) return;
          registrationBusy = true;
          setPushRegistration('registering');
          try {
            await api.post('/api/voice/devices', {
              deviceId: await pushDeviceId(),
              platform: Platform.OS,
              token,
              environment: Platform.OS === 'ios' && __DEV__ ? 'sandbox' : 'production',
              bundleId: Platform.OS === 'ios' ? 'app.vocivo.mobile' : undefined,
            });
            registeredToken = token;
            if (!canceled) setPushRegistration('registered');
          } catch {
            if (!canceled) setPushRegistration('unavailable');
          } finally {
            registrationBusy = false;
          }
        };
        await login();
        if (pushNotificationDeviceToken) await registerLatestDevice(pushNotificationDeviceToken);
        if (Platform.OS === 'ios' || Platform.OS === 'android') setPushRegistration(registeredToken ? 'registered' : 'registering');
        if (!pushNotificationDeviceToken && (Platform.OS === 'ios' || Platform.OS === 'android')) {
          tokenTimer = setInterval(() => {
            registerLatestDevice().then(() => {
              if (!registeredToken || !tokenTimer) return;
              clearInterval(tokenTimer);
              tokenTimer = undefined;
            }).catch(() => undefined);
          }, 2000);
        }
        if (Platform.OS === 'android') {
          tokenRefreshSubscription = onAndroidPushTokenRefresh((token) => {
            registeredToken = undefined;
            registerLatestDevice(token).catch(() => undefined);
          });
        }
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          appStateSubscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active' || canceled) return;
            if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
            activeRegistrationTimer = setTimeout(() => registerLatestDevice().catch(() => undefined), 750);
          });
        }
      } catch (voiceError) {
        if (Platform.OS === 'ios' || Platform.OS === 'android') setPushRegistration('unavailable');
        if (!canceled) setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
      }
    };
    connect();
    return () => {
      canceled = true;
      if (tokenTimer) clearInterval(tokenTimer);
      if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
      appStateSubscription?.remove();
      tokenRefreshSubscription?.();
    };
  }, [isAuthenticated, isPreview, loading]);

  useEffect(() => {
    if (loading || !isAuthenticated || isPreview) return;
    let canceled = false;
    let reconnecting = false;
    let retryDelay = 1_000;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backgroundedAt = 0;
    let previousNetworkRoute: string | undefined;

    const scheduleReconnect = (delay: number) => {
      if (canceled || reconnectTimer || voipClient.currentConnectionState === TelnyxConnectionState.CONNECTED) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        reconnect().catch(() => undefined);
      }, delay);
    };

    const reconnect = async () => {
      const config = loginConfigRef.current;
      if (canceled || reconnecting || !config || voipClient.currentConnectionState === TelnyxConnectionState.CONNECTED) return;
      const network = await NetInfo.fetch();
      if (!network.isConnected || network.isInternetReachable === false) {
        scheduleReconnect(3_000);
        return;
      }
      reconnecting = true;
      try {
        await voipClient.login(createCredentialConfig(config.sipUser, config.sipPassword, {
          sipDomain: config.sipDomain,
          websocketUrl: config.websocketUrl,
          extension: config.extension,
          displayName: profile?.full_name || undefined,
          incomingCallRingtone: config.ringtone,
          iceServers: config.iceServers,
        }));
        retryDelay = 1_000;
      } catch (reconnectError) {
        if (!canceled) {
          setError(reconnectError instanceof Error ? reconnectError.message : 'Unable to reconnect to calling service.');
          scheduleReconnect(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      } finally {
        reconnecting = false;
      }
    };

    const connectionSubscription = voipClient.connectionState$.subscribe((state) => {
      if (state === TelnyxConnectionState.CONNECTED) {
        retryDelay = 1_000;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        return;
      }
      scheduleReconnect(state === TelnyxConnectionState.CONNECTING ? 13_000 : retryDelay);
    });
    const refreshOrReconnect = () => {
      if (voipClient.currentConnectionState === TelnyxConnectionState.CONNECTED) {
        voipClient.refreshRegistration().catch(() => scheduleReconnect(0));
      } else {
        scheduleReconnect(0);
      }
    };
    const networkSubscription = NetInfo.addEventListener((state) => {
      const details = state.details && typeof state.details === 'object' ? state.details as Record<string, unknown> : undefined;
      const route = state.isConnected
        ? `${state.type}:${String(details?.ipAddress || details?.carrier || '')}`
        : 'offline';
      const migrated = Boolean(previousNetworkRoute && previousNetworkRoute !== 'offline' && route !== 'offline' && route !== previousNetworkRoute);
      previousNetworkRoute = route;
      const migration = voipClient.handleNetworkRoute(route);
      if (migrated) {
        migration
          .then((restarted) => { if (!restarted) refreshOrReconnect(); })
          .catch((error) => setError(error instanceof Error ? error.message : 'Call media could not recover after the network changed.'));
      } else if (state.isConnected && state.isInternetReachable !== false) {
        refreshOrReconnect();
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        backgroundedAt = Date.now();
        return;
      }
      const wasSuspended = backgroundedAt > 0 && Date.now() - backgroundedAt >= 5_000;
      backgroundedAt = 0;
      if (wasSuspended && !voipClient.currentCalls.length) {
        reconnecting = true;
        voipClient.reconnect()
          .then(() => {
            retryDelay = 1_000;
            setError('');
          })
          .catch((reconnectError) => {
            if (!canceled) {
              setError(reconnectError instanceof Error ? reconnectError.message : 'Unable to reconnect to calling service.');
              scheduleReconnect(retryDelay);
            }
          })
          .finally(() => { reconnecting = false; });
        return;
      }
      refreshOrReconnect();
    });

    scheduleReconnect(500);
    return () => {
      canceled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      connectionSubscription.unsubscribe();
      networkSubscription();
      appStateSubscription.remove();
    };
  }, [isAuthenticated, isPreview, loading, profile?.full_name]);

  const refreshIncomingCalls = useCallback(async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    setPushRegistration('registering');
    let data = loginConfigRef.current;
    if (!data) {
      const credentials = await api.get<{ sip_user: string; sip_password: string; sip_domain: string; websocket_url: string; extension: string; ice_servers?: Array<{ urls: string | string[]; username?: string; credential?: string }> }>('/api/voice/config');
      data = { sipUser: credentials.sip_user, sipPassword: credentials.sip_password, sipDomain: credentials.sip_domain, websocketUrl: credentials.websocket_url, extension: credentials.extension, ringtone: await loadIncomingRingtone(), iceServers: credentials.ice_servers };
    }
    loginConfigRef.current = data;
    const token = Platform.OS === 'ios' ? await waitForVoipToken() : await getAndroidPushToken();
    if (!token) {
      setPushRegistration('unavailable');
      throw new Error(`${Platform.OS === 'ios' ? 'iPhone' : 'Android'} did not provide a push token. Allow notifications, then reopen Vocivo and try again.`);
    }
    await Promise.all([
      voipClient.login(createCredentialConfig(data.sipUser, data.sipPassword, { sipDomain: data.sipDomain, websocketUrl: data.websocketUrl, extension: data.extension, displayName: profile?.full_name || undefined, incomingCallRingtone: data.ringtone, iceServers: data.iceServers })),
      api.post('/api/voice/devices', {
        deviceId: await pushDeviceId(),
        platform: Platform.OS,
        token,
        environment: Platform.OS === 'ios' && __DEV__ ? 'sandbox' : 'production',
        bundleId: Platform.OS === 'ios' ? 'app.vocivo.mobile' : undefined,
      }),
    ]);
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
          await voipClient.endCall(callId).catch(() => undefined);
          return;
        }
      } catch (routeError) {
        if (attempt > 8) {
          stopRingback();
          setError(routeError instanceof Error ? routeError.message : 'Call status could not be confirmed.');
          await voipClient.endCall(callId).catch(() => undefined);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (routePollGenerationRef.current === generation) {
      stopRingback();
      setError('Call setup timed out. Please try again.');
      await voipClient.endCall(callId).catch(() => undefined);
    }
  }, [stopRingback]);

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
    const attempt = ++startAttemptRef.current;
    const startedAt = Date.now();
    const optimisticCall: ActiveCall = { number, displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, phase: 'connecting', startedAt, muted: false, speaker: false, onHold: false };
    activeCallRef.current = optimisticCall;
    setActiveCall(optimisticCall);
    startingCallRef.current = true;
    try {
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', displayName || rate.country_name, callerNumber?.phone_number, outboundHeaders(number, callerNumber?.phone_number, 'outbound'));
      if (startAttemptRef.current !== attempt) {
        await call.hangup().catch(() => undefined);
        return;
      }
      callMetaRef.current.set(call.callId, { displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, startedAt, callerId: callerNumber?.phone_number });
      attachCall(call);
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
  }, [attachCall, connection, isPreview, profile?.full_name, stopRingback]);

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
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', rate.country_name, callerNumber?.phone_number, outboundHeaders(number, callerNumber?.phone_number, 'outbound'));
      callMetaRef.current.set(call.callId, { displayName: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now(), callerId: callerNumber?.phone_number });
      voipClient.setActiveCall(call.callId);
      attachCall(call);
    } catch (secondCallError) {
      stopRingback();
      await current.resume().catch(() => undefined);
      voipClient.setActiveCall(current.callId);
      attachCall(current);
      throw secondCallError;
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [attachCall, connection, isPreview, profile?.full_name, stopRingback]);

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
    const destination = extension;
    const attempt = ++startAttemptRef.current;
    const startedAt = Date.now();
    const optimisticCall: ActiveCall = { number: extension, displayName, destinationCountry: 'Internal', photoUrl, phase: 'connecting', startedAt, muted: false, speaker: false, onHold: false };
    activeCallRef.current = optimisticCall;
    setActiveCall(optimisticCall);
    startingCallRef.current = true;
    try {
      const call = await voipClient.newCall(destination, profile?.full_name || 'Vocivo', displayName, profile?.extension, outboundHeaders(destination, undefined, 'internal'));
      if (startAttemptRef.current !== attempt) {
        await call.hangup().catch(() => undefined);
        return;
      }
      callMetaRef.current.set(call.callId, { number: extension, displayName, destinationCountry: 'Internal', photoUrl, startedAt });
      attachCall(call);
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
  }, [attachCall, connection, isPreview, profile?.extension, profile?.full_name, stopRingback]);

  const transferCall = useCallback(async (targetExtensionId: string) => {
    if (isPreview) throw new Error('Transfer requires a live business call.');
    const call = voipClient.currentActiveCall;
    if (!call) throw new Error('Connect the call before transferring it.');
    const directory = await api.get<{ users: Array<{ id: string; extension: string }> }>('/api/voice/directory');
    const target = directory.users.find((user) => user.id === targetExtensionId);
    if (!target) throw new Error('The selected colleague is unavailable.');
    await call.transfer(target.extension);
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
    await voipClient.endCall(waitingCall.id, { reason: 'rejected' });
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
    const participants = [describeCall(current), describeCall(held)];
    multiCallBusyRef.current = true;
    try {
      const merged = await voipClient.mergeCalls(held.callId);
      conferenceCallIdsRef.current = [merged.host.callId];
      setHeldCall(null);
      setConference({ id: merged.room, participants: merged.participants.map((call) => participants.find((item) => item.id === call.callId) || describeCall(call)) });
      attachCall(merged.host);
      if (merged.partial) setError('One participant could not join the conference.');
    } finally {
      multiCallBusyRef.current = false;
    }
  }, [attachCall, describeCall, heldCall?.id, isPreview]);

  const removeConferenceParticipant = useCallback(async (participantId: string) => {
    const currentConference = conference;
    const participant = currentConference?.participants.find((item) => item.id === participantId);
    if (!currentConference || !participant?.id) throw new Error('This conference participant is no longer available.');
    if (participant.id === currentConference.participants[0]?.id) throw new Error('The primary caller cannot be removed while the conference is active.');
    if (multiCallBusyRef.current) throw new Error('Another call action is still completing.');
    multiCallBusyRef.current = true;
    try {
      await voipClient.getCall(participant.id)?.hangup();
      const remaining = currentConference.participants.filter((item) => item.id !== participantId);
      conferenceCallIdsRef.current = conferenceCallIdsRef.current.filter((id) => id !== participantId);
      callMetaRef.current.delete(participantId);
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
    if (endCallOperationRef.current) return endCallOperationRef.current;
    const operation = (async () => {
      startAttemptRef.current += 1;
      startingCallRef.current = false;
      routePollGenerationRef.current += 1;
      stopRingback();
      if (conferenceCallIdsRef.current.length) {
        const mergedIds = [...conferenceCallIdsRef.current];
        mergedIds.forEach((id) => endingCallIdsRef.current.add(id));
        conferenceCallIdsRef.current = [];
        setConference(null);
        setHeldCall(null);
        finalizeCall('ended', activeCall?.id);
        setActiveCall((current) => current ? { ...current, phase: 'ended' } : current);
        await Promise.all(mergedIds.map((id) => voipClient.endCall(id).catch(() => undefined)));
        setTimeout(() => setActiveCall(null), 200);
        return;
      }
      const callId = activeCall?.id || callRef.current?.callId;
      if (!callId) return;
      endingCallIdsRef.current.add(callId);
      const resumeAfterEnd = voipClient.currentCalls.find((call) => call.callId !== callId && call.currentState === TelnyxCallState.HELD);
      const terminationReason = activeCallRef.current?.id === callId && activeCallRef.current.isIncoming && activeCallRef.current.phase === 'ringing'
        ? 'rejected'
        : 'local_ended';
      finalizeCall('ended', callId);
      setActiveCall((current) => current ? { ...current, phase: 'ended' } : current);
      await voipClient.endCall(callId, { reason: terminationReason }).catch(() => undefined);
      if (resumeAfterEnd) {
        await resumeAfterEnd.resume().catch(() => undefined);
        voipClient.setActiveCall(resumeAfterEnd.callId);
        attachCall(resumeAfterEnd);
        return;
      }
      setTimeout(() => setActiveCall(null), 200);
    })();
    endCallOperationRef.current = operation;
    try {
      await operation;
    } finally {
      if (endCallOperationRef.current === operation) endCallOperationRef.current = null;
    }
  }, [activeCall?.id, attachCall, finalizeCall, stopRingback]);

  const answerCall = useCallback(async () => {
    const call = callRef.current;
    if (!call || !call.isIncoming) return;
    if (![TelnyxCallState.RINGING, TelnyxCallState.CONNECTING].includes(call.currentState)) return;
    setError(null);
    setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'connecting' } : current);
    try {
      voipClient.setActiveCall(call.callId);
      await VoicePnBridge.answerCall(call.callId);
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
  return <VoiceProvider>{children}</VoiceProvider>;
}

export function useVoice() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('useVoice must be used inside VoiceRoot');
  return value;
}
