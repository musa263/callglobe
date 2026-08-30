import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import NetInfo, { type NetInfoStateType } from '@react-native-community/netinfo';
import { Platform } from 'react-native';
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
import { loadVoiceSession, persistVoiceSession, voipClient } from '../lib/voipClient';
import { CallLifecycleRegistry, isTerminalCallState, transactCallWaiting } from '../lib/callLifecycle';
import { attachIceFailureListener, isTransportNetworkMigration, isVoiceSessionFresh, VoiceMediaRecoveryCoordinator, waitForBidirectionalMedia } from '../lib/voiceRecovery';
import type { ActiveCall, CallerNumber, CallRate, MergedConference } from '../types';
import { inviteHeader, visibleCallAddress } from '../voice/callIdentity';
import { toCallPhase, toLifecycleState, waitForCallState } from '../voice/callState';
import type { VoiceContextValue, VoiceLoginConfig, VoiceTokenResponse } from '../voice/contracts';
import { createRouteId, outboundHeaders, voiceLoginConfig, waitForVoiceConnection, waitForVoicePushToken } from '../voice/session';
import { useVoiceRegistration } from '../voice/useVoiceRegistration';
import { useAuth } from './AuthContext';

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children, bootstrapSession }: { children: React.ReactNode; bootstrapSession?: VoiceLoginConfig | null }) {
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
  const conferenceCallIdsRef = useRef(new Set<string>());
  const multiCallBusyRef = useRef(false);
  const startingCallRef = useRef(false);
  const startAttemptRef = useRef(0);
  const attachTimersRef = useRef(new Map());
  const activeCallRef = useRef<ActiveCall | null>(null);
  const durationRef = useRef(0);
  const loggedCalls = useRef(new Set<string>());
  const lifecycleRef = useRef(new CallLifecycleRegistry());
  const callSubscriptions = useRef(new Map<string, Array<{ unsubscribe: () => void }>>());
  const routePollsRef = useRef(new Map<string, { cancelled: boolean; timer?: ReturnType<typeof setTimeout>; wake?: () => void }>());
  const loginConfigRef = useRef<VoiceLoginConfig | null>(null);
  const iceListenerCleanupRef = useRef(new Map<string, () => void>());
  const lastNetworkTypeRef = useRef<NetInfoStateType | null>(null);
  const networkMigrationGraceUntilRef = useRef(0);
  const transportLossTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportVoiceError = useCallback((operation: string, failure: unknown) => {
    const normalized = failure instanceof Error ? failure : new Error(String(failure));
    console.error(`[Vocivo Voice] ${operation} failed`, { message: normalized.message, stack: normalized.stack });
  }, []);
  const mediaRecoveryRef = useRef(new VoiceMediaRecoveryCoordinator(
    (operation, failure) => {
      const normalized = failure instanceof Error ? failure : new Error(String(failure));
      console.error(`[Vocivo Voice] ${operation} failed`, { message: normalized.message, stack: normalized.stack });
    },
  ));

  // Telnyx streams ringback into the parked call leg. Keeping Expo Audio out of
  // an active call also leaves the iOS WebRTC/CallKit audio session authoritative.
  const startRingback = useCallback(() => undefined, []);
  const stopRingback = useCallback(() => undefined, []);

  const cancelRoutePolling = useCallback((callId?: string) => {
    const targets = callId
      ? [[callId, routePollsRef.current.get(callId)] as const]
      : Array.from(routePollsRef.current.entries());
    targets.forEach(([id, monitor]) => {
      if (!monitor) return;
      monitor.cancelled = true;
      if (monitor.timer) clearTimeout(monitor.timer);
      monitor.wake?.();
      routePollsRef.current.delete(id);
    });
  }, []);

  const clearCallSubscriptions = useCallback((callId?: string) => {
    const ids = callId ? [callId] : Array.from(callSubscriptions.current.keys());
    ids.forEach((id) => {
      iceListenerCleanupRef.current.get(id)?.();
      iceListenerCleanupRef.current.delete(id);
      callSubscriptions.current.get(id)?.forEach((subscription) => subscription.unsubscribe());
      callSubscriptions.current.delete(id);
      (attachTimersRef.current.get(id) || []).forEach((timer) => clearTimeout(timer));
      attachTimersRef.current.delete(id);
    });
    if (!callId) {
      attachTimersRef.current.forEach((timers) => timers.forEach((timer) => clearTimeout(timer)));
      attachTimersRef.current.clear();
    }
  }, []);

  const terminateCall = useCallback((callId: string, routeId?: string) => lifecycleRef.current.terminate(callId, async () => {
    const call = voipClient.getCall(callId);
    // Cancel server-side forked destinations before ending the local leg. If
    // cancellation fails, preserve the call and lifecycle lock for a retry so
    // another device cannot continue ringing behind a dismissed local screen.
    if (routeId) await api.post('/api/voice/cancel', { routeId });
    if (call) await call.hangup();
    else await VoicePnBridge.endCall(callId);
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
    const usableCallerName = call.callerName && !/^(?:unknown caller|vocivo)$/i.test(call.callerName.trim()) && !/^sip:/i.test(call.callerName)
      ? call.callerName
      : '';
    const fallbackName = usableCallerName || (isInternal ? 'Company colleague' : visibleCallAddress(call.destination));
    return {
      id: call.callId,
      number: meta.number || internalExtension || visibleCallAddress(fallbackNumber),
      displayName: meta.displayName || internalName || fallbackName,
      destinationCountry: meta.destinationCountry || (isInternal ? 'Internal' : undefined),
      countryCode: meta.countryCode,
      ratePerMinute: meta.ratePerMinute,
      phase: toCallPhase(call.currentState),
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
    const historyEntry = {
      id,
      destination_number: snapshot.number,
      destination_name: snapshot.displayName !== snapshot.destinationCountry ? snapshot.displayName : undefined,
      destination_country: snapshot.destinationCountry,
      duration_seconds: seconds,
      total_cost: Number(totalCost.toFixed(4)),
      status: phase === 'ended' && Boolean(snapshot.connectedAt) ? 'completed' : snapshot.isIncoming ? 'missed' : 'no_answer',
      started_at: new Date(snapshot.startedAt).toISOString(),
    } as const;

    try {
      void Promise.resolve(addHistory(historyEntry)).catch((failure) => {
        loggedCalls.current.delete(id);
        reportVoiceError('save call history', failure);
      });
    } catch (failure) {
      loggedCalls.current.delete(id);
      reportVoiceError('save call history', failure);
    }
  }, [addHistory, describeCall, reportVoiceError]);

  const confirmMediaConnected = useCallback(async (call: Call) => {
    const mediaReady = await waitForBidirectionalMedia(call);
    if (call.currentState !== TelnyxCallState.ACTIVE) return;
    if (!mediaReady) {
      setError('The call connected, but the audio path is still recovering.');
      mediaRecoveryRef.current.recover(call, 'active-call-media-not-ready')
        .catch((failure) => reportVoiceError('recover active call media', failure));
      return;
    }
    const existing = callMetaRef.current.get(call.callId) ?? {};
    const connectedAt = existing.connectedAt ?? Date.now();
    callMetaRef.current.set(call.callId, { ...existing, connectedAt });
    setActiveCall((current) => {
      if (current?.id !== call.callId) return current;
      const next = { ...current, phase: 'active' as const, connectedAt };
      activeCallRef.current = next;
      return next;
    });
  }, [reportVoiceError]);

  const attachCall = useCallback((call: Call | null) => {
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
    const bindIceListener = () => {
      if (iceListenerCleanupRef.current.has(call.callId)) return;
      const cleanup = attachIceFailureListener(call, (reason) => {
        mediaRecoveryRef.current.recover(call, reason).catch((failure) => reportVoiceError(reason, failure));
      });
      if (cleanup) iceListenerCleanupRef.current.set(call.callId, cleanup);
    };
    bindIceListener();
    if (!callMetaRef.current.has(call.callId)) callMetaRef.current.set(call.callId, { startedAt: base.startedAt, connectedAt: base.connectedAt });
    setActiveCall((existing) => {
      const next = { ...base, speaker: existing?.speaker ?? base.speaker };
      activeCallRef.current = next;
      return next;
    });
    const connectedAt = callMetaRef.current.get(call.callId)?.connectedAt;
    durationRef.current = connectedAt ? call.currentDuration : 0;
    setDuration(connectedAt ? call.currentDuration : 0);

    if (callSubscriptions.current.has(call.callId)) return;
    const subscriptions = [
      call.callState$.subscribe((state) => {
        if ([TelnyxCallState.CONNECTING, TelnyxCallState.ACTIVE, TelnyxCallState.DROPPED].includes(state)) bindIceListener();
        const lifecycleState = toLifecycleState(state);
        const previousLifecycleState = lifecycleRef.current.state(call.callId);
        const transitioned = lifecycleRef.current.transition(call.callId, lifecycleState);
        if (!transitioned && previousLifecycleState !== lifecycleState) {
          return;
        }
        const phase = toCallPhase(state);
        if (state === TelnyxCallState.ACTIVE) {
          cancelRoutePolling(call.callId);
          stopRingback();
          void confirmMediaConnected(call).catch((failure) => reportVoiceError('confirm bidirectional media', failure));
        }
        setActiveCall((current) => {
          if (current?.id !== call.callId) return current;
          const next = { ...current, phase };
          activeCallRef.current = next;
          return next;
        });
        if (phase === 'ended' || phase === 'failed') {
          cancelRoutePolling(call.callId);
          stopRingback();
          finalizeCall(phase, call.callId);
          callRouteIdsRef.current.delete(call.callId);
          callMetaRef.current.delete(call.callId);
          clearCallSubscriptions(call.callId);
          const releaseTimer = setTimeout(() => lifecycleRef.current.release(call.callId), 60_000);
          const resumeTimer = setTimeout(() => {
            const remaining = voipClient.currentCalls.find((candidate) => candidate.callId !== call.callId && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(candidate.currentState));
            if (!remaining) {
              attachCall(null);
              return;
            }
            if (remaining.currentState === TelnyxCallState.HELD) remaining.resume().catch((failure) => reportVoiceError('resume remaining call', failure));
            voipClient.setActiveCall(remaining.callId);
            attachCall(remaining);
          }, 200);
          attachTimersRef.current.set(call.callId, [releaseTimer, resumeTimer]);
        }
      }),
      call.isMuted$.subscribe((muted) => setActiveCall((current) => current ? { ...current, muted } : current)),
      call.isHeld$.subscribe((onHold) => setActiveCall((current) => current ? { ...current, onHold } : current)),
    ];
    callSubscriptions.current.set(call.callId, subscriptions);
  }, [cancelRoutePolling, clearCallSubscriptions, confirmMediaConnected, describeCall, finalizeCall, reportVoiceError, stopRingback]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((network) => {
      const previous = lastNetworkTypeRef.current;
      lastNetworkTypeRef.current = network.type;
      if (!isTransportNetworkMigration(previous, network.type) || network.isConnected !== true) return;
      networkMigrationGraceUntilRef.current = Date.now() + 5_000;
      const current = callRef.current;
      const phase = activeCallRef.current?.phase;
      if (!current || !['active', 'connecting', 'ringing'].includes(phase || '')) return;
      mediaRecoveryRef.current.recover(current, `network-${previous}-to-${network.type}`)
        .catch((failure) => reportVoiceError('network migration recovery', failure));
    });
    return unsubscribe;
  }, [reportVoiceError]);

  const emergencyTransportCleanup = useCallback((state: TelnyxConnectionState) => {
    startAttemptRef.current += 1;
    if (transportLossTimerRef.current) clearTimeout(transportLossTimerRef.current);
    transportLossTimerRef.current = null;
    networkMigrationGraceUntilRef.current = 0;
    const calls = voipClient.currentCalls.filter((call) => ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState));
    if (activeCallRef.current) finalizeCall('failed', activeCallRef.current.id);
    if (heldCall) finalizeCall('failed', heldCall.id);
    if (!calls.length && !activeCallRef.current) return;
    cancelRoutePolling();
    stopRingback();
    clearCallSubscriptions();
    conferenceCallIdsRef.current.clear();
    setConference(null);
    setWaitingCall(null);
    setHeldCall(null);
    setDuration(0);
    durationRef.current = 0;
    activeCallRef.current = null;
    callRef.current = null;
    setActiveCall(null);
    setError(`The calling connection was lost (${state.toLowerCase()}). The call was closed safely.`);
    lifecycleRef.current.clear();
    calls.forEach((call) => {
      VoicePnBridge.endCall(call.callId).catch((failure) => reportVoiceError('close native call after transport loss', failure));
    });
  }, [cancelRoutePolling, clearCallSubscriptions, finalizeCall, heldCall, reportVoiceError, stopRingback]);

  useEffect(() => {
    const connectionSubscription = voipClient.connectionState$.subscribe((state) => {
      setConnection(state);
      if (state === TelnyxConnectionState.CONNECTED) {
        if (transportLossTimerRef.current) clearTimeout(transportLossTimerRef.current);
        transportLossTimerRef.current = null;
        const current = callRef.current;
        if (current && networkMigrationGraceUntilRef.current > Date.now()) {
          mediaRecoveryRef.current.recover(current, 'signaling-reconnected-after-network-migration')
            .catch((failure) => reportVoiceError('post-migration media recovery', failure));
        }
        networkMigrationGraceUntilRef.current = 0;
        return;
      }
      if (state === TelnyxConnectionState.DISCONNECTED && networkMigrationGraceUntilRef.current > Date.now()) {
        if (transportLossTimerRef.current) clearTimeout(transportLossTimerRef.current);
        const delay = Math.max(0, networkMigrationGraceUntilRef.current - Date.now());
        transportLossTimerRef.current = setTimeout(() => {
          if (voipClient.currentConnectionState !== TelnyxConnectionState.CONNECTED) emergencyTransportCleanup(state);
        }, delay);
        return;
      }
      if (state === TelnyxConnectionState.ERROR || state === TelnyxConnectionState.DISCONNECTED) {
        emergencyTransportCleanup(state);
      }
    });
    const callsSubscription = voipClient.calls$.subscribe((calls) => {
      const currentId = voipClient.currentActiveCall?.callId;
      const waiting = calls.find((call) => call.callId !== currentId && call.isIncoming && call.currentState === TelnyxCallState.RINGING);
      const held = calls.find((call) => call.callId !== currentId && call.currentState === TelnyxCallState.HELD);
      setWaitingCall(waiting ? describeCall(waiting) : null);
      const mergedCalls = Array.from(conferenceCallIdsRef.current)
        .map((id) => calls.find((call) => call.callId === id))
        .filter((call): call is Call => Boolean(call && ![TelnyxCallState.ENDED, TelnyxCallState.FAILED].includes(call.currentState)));
      if (conferenceCallIdsRef.current.size && mergedCalls.length >= 1) {
        setHeldCall(null);
      } else {
        if (conferenceCallIdsRef.current.size) {
          conferenceCallIdsRef.current.clear();
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
      if (transportLossTimerRef.current) clearTimeout(transportLossTimerRef.current);
      transportLossTimerRef.current = null;
      clearCallSubscriptions();
      lifecycleRef.current.clear();
    };
  }, [attachCall, clearCallSubscriptions, describeCall, emergencyTransportCleanup, reportVoiceError]);

  useVoiceRegistration({
    activeCallRef,
    bootstrapSession,
    isAuthenticated,
    isPreview,
    loading,
    loginConfigRef,
    reportVoiceError,
    setError,
    setPushRegistration,
  });

  const refreshIncomingCalls = useCallback(async () => {
    setPushRegistration('registering');
    let data = loginConfigRef.current;
    if (!isVoiceSessionFresh(data, 60_000)) {
      const session = await api.post<VoiceTokenResponse>('/api/telnyx/token', {});
      data = voiceLoginConfig(session, await loadIncomingRingtone());
    }
    loginConfigRef.current = data;
    await persistVoiceSession(data);
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
    cancelRoutePolling(callId);
    const monitor: { cancelled: boolean; timer?: ReturnType<typeof setTimeout>; wake?: () => void } = { cancelled: false };
    routePollsRef.current.set(callId, monitor);
    let lastRouteError: unknown;
    for (let attempt = 0; attempt < 100 && !monitor.cancelled; attempt += 1) {
      try {
        const result = await api.get<{ phase: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed'; connectedAt?: string; failureCause?: string }>(`/api/voice/status?routeId=${encodeURIComponent(routeId)}`);
        if (monitor.cancelled) return;
        const sdkCall = voipClient.getCall(callId);
        const sdkIsLive = sdkCall && [TelnyxCallState.ACTIVE, TelnyxCallState.HELD].includes(sdkCall.currentState);
        if (sdkIsLive) {
          cancelRoutePolling(callId);
          stopRingback();
          return;
        }
        if (result.phase === 'connected') {
          // Route status confirms the server bridge only. The SDK ACTIVE event
          // remains authoritative for UI state and media timer inception.
          stopRingback();
        }
        if (result.phase === 'failed' || result.phase === 'ended') {
          stopRingback();
          if (result.phase === 'failed' && result.failureCause) setError(`Call failed: ${result.failureCause.replaceAll('_', ' ')}.`);
          // Yield once so an SDK ACTIVE event queued with this webhook wins the
          // state mutex before route cleanup can claim a ringing call.
          await new Promise((resolve) => setTimeout(resolve, 0));
          const latestSdkCall = voipClient.getCall(callId);
          const latestLifecycle = lifecycleRef.current.state(callId);
          const isNowLive = Boolean(latestSdkCall && [TelnyxCallState.ACTIVE, TelnyxCallState.HELD].includes(latestSdkCall.currentState))
            || ['ACTIVE', 'HELD'].includes(latestLifecycle);
          if (isNowLive || monitor.cancelled) {
            cancelRoutePolling(callId);
            return;
          }
          if (!latestSdkCall || [TelnyxCallState.RINGING, TelnyxCallState.CONNECTING].includes(latestSdkCall.currentState)) {
            try {
              await terminateCall(callId, routeId);
            } catch (failure) {
              reportVoiceError('terminate failed route', failure);
              setError('The call route ended, but signaling cleanup failed. Tap end call to retry.');
            }
          }
          return;
        }
      } catch (routeError) {
        // Route status is advisory; the Telnyx SDK owns the live media call.
        // A brief Vercel/network polling failure must never tear down a healthy
        // SIP session. Keep polling and only fail at the full setup deadline.
        lastRouteError = routeError;
        if (attempt === 9 || attempt === 39) reportVoiceError('poll extension route status', routeError);
      }
      await new Promise<void>((resolve) => {
        monitor.wake = resolve;
        monitor.timer = setTimeout(resolve, attempt < 40 ? 250 : 750);
      });
      monitor.timer = undefined;
      monitor.wake = undefined;
    }
    if (!monitor.cancelled) {
      stopRingback();
      setError(lastRouteError instanceof Error ? 'Call status could not be confirmed. The live call remains available.' : 'Call setup is taking longer than expected.');
    }
    if (routePollsRef.current.get(callId) === monitor) routePollsRef.current.delete(callId);
  }, [cancelRoutePolling, reportVoiceError, stopRingback, terminateCall]);

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
        await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel failed outbound route', failure));
        return;
      }
      startRingback();
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', reservation.callerId, outboundHeaders(number, reservation.callerId, 'outbound', routeId, reservation.routeToken));
      if (startAttemptRef.current !== attempt) {
        await Promise.all([
          call.hangup().catch((failure) => reportVoiceError('hang up failed outbound call', failure)),
          api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel rejected outbound route', failure)),
        ]);
        return;
      }
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { displayName: displayName || rate.country_name, destinationCountry: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, photoUrl, startedAt, routeId, callerId: reservation.callerId });
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (startError) {
      stopRingback();
      await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel failed outbound route', failure));
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
    if (!callerNumber?.phone_number) throw new Error('Choose a caller ID before adding an external caller.');
    multiCallBusyRef.current = true;
    const routeId = createRouteId();
    const attempt = startAttemptRef.current;
    try {
      await current.hold();
      if (startAttemptRef.current !== attempt) throw new Error('The first call ended before the second caller could be added.');
      const reservation = await api.post<{ routeId: string; routeToken: string; callerId?: string }>('/api/voice/route', { routeId, destination: number, callerId: callerNumber?.phone_number, flow: 'outbound' });
      if (startAttemptRef.current !== attempt) {
        await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel superseded second-call route', failure));
        throw new Error('The first call ended before the second caller could be added.');
      }
      startRingback();
      const call = await voipClient.newCall(number, profile?.full_name || 'Vocivo', reservation.callerId, outboundHeaders(number, reservation.callerId, 'outbound', routeId, reservation.routeToken));
      if (startAttemptRef.current !== attempt) {
        await Promise.all([
          call.hangup().catch((failure) => reportVoiceError('hang up superseded second call', failure)),
          api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel superseded second-call route', failure)),
        ]);
        throw new Error('The first call ended before the second caller could be added.');
      }
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { displayName: rate.country_name, countryCode: rate.country_code, ratePerMinute: rate.rate_per_min ?? undefined, startedAt: Date.now(), routeId, callerId: reservation.callerId });
      voipClient.setActiveCall(call.callId);
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (secondCallError) {
      stopRingback();
      await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel failed second-call route', failure));
      await current.resume().catch((failure) => reportVoiceError('roll back held outbound call', failure));
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
    const destination = `sip:${sipUsername}@sip.telnyx.com`;
    const routeId = createRouteId();
    const attempt = ++startAttemptRef.current;
    const startedAt = Date.now();
    const optimisticCall: ActiveCall = { number: extension, displayName, destinationCountry: 'Internal', photoUrl, phase: 'connecting', startedAt, muted: false, speaker: false, onHold: false, routeId };
    activeCallRef.current = optimisticCall;
    setActiveCall(optimisticCall);
    startingCallRef.current = true;
    try {
      await waitForVoiceConnection();
      const reservation = await api.post<{ routeToken: string; callerName: string; callerExtension: string; destinationName?: string; destinationExtension?: string; destination: string }>('/api/voice/route', { routeId, destination, targetExtension: extension, flow: 'internal' });
      if (startAttemptRef.current !== attempt) {
        await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel failed internal route', failure));
        return;
      }
      startRingback();
      const remoteName = reservation.destinationName || displayName;
      const remoteExtension = reservation.destinationExtension || extension;
      const call = await voipClient.newCall(
        reservation.destination,
        reservation.callerName || profile?.full_name || 'Vocivo',
        reservation.callerExtension || profile?.extension,
        outboundHeaders(reservation.destination, undefined, 'internal', routeId, reservation.routeToken, { name: remoteName, extension: remoteExtension }),
      );
      if (startAttemptRef.current !== attempt) {
        await Promise.all([
          call.hangup().catch((failure) => reportVoiceError('hang up failed internal call', failure)),
          api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel rejected internal route', failure)),
        ]);
        return;
      }
      callRouteIdsRef.current.set(call.callId, routeId);
      callMetaRef.current.set(call.callId, { number: remoteExtension, displayName: remoteName, destinationCountry: 'Internal', photoUrl, startedAt, routeId });
      attachCall(call);
      followRoute(routeId, call.callId);
    } catch (startError) {
      stopRingback();
      await api.post('/api/voice/cancel', { routeId }).catch((failure) => reportVoiceError('cancel failed internal route', failure));
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
    await transactCallWaiting({
      answerIncoming: async () => {
        await incoming.answer();
        await waitForCallState(incoming, TelnyxCallState.ACTIVE);
      },
      isIncomingAcknowledged: () => incoming.currentState === TelnyxCallState.ACTIVE,
      holdCurrent: async () => {
        if (current && current.callId !== incoming.callId && current.currentState === TelnyxCallState.ACTIVE) await current.hold();
      },
      activateIncoming: () => {
        voipClient.setActiveCall(incoming.callId);
        attachCall(incoming);
      },
      rollbackIncoming: async () => {
        try {
          await incoming.hangup();
        } catch (rollbackFailure) {
          reportVoiceError('roll back waiting call', rollbackFailure);
          throw rollbackFailure;
        }
      },
      restoreCurrent: () => {
        if (!current) return;
        voipClient.setActiveCall(current.callId);
        attachCall(current);
      },
    });
  }, [attachCall, reportVoiceError, waitingCall?.id]);

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
    if (conferenceCallIdsRef.current.size) throw new Error('These calls are already merged.');
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
      conferenceCallIdsRef.current = new Set([current.callId, held.callId]);
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
    cancelRoutePolling();
    stopRingback();
    attachTimersRef.current.forEach((timers) => timers.forEach((timer) => clearTimeout(timer)));
    attachTimersRef.current.clear();
    if (conferenceCallIdsRef.current.size) {
      const mergedIds = [...conferenceCallIdsRef.current];
      try {
        await Promise.all(mergedIds.map((id) => terminateCall(id, callRouteIdsRef.current.get(id))));
      } catch (failure) {
        reportVoiceError('end conference', failure);
        setError('Conference hangup was not acknowledged. Tap end call to retry.');
        throw failure;
      }
      conferenceCallIdsRef.current.clear();
      setConference(null);
      setHeldCall(null);
      finalizeCall('ended', activeCall?.id);
      activeCallRef.current = null;
      setActiveCall(null);
      return;
    }
    const callId = activeCall?.id || callRef.current?.callId;
    const routeId = activeCall?.routeId || (callId ? callRouteIdsRef.current.get(callId) : undefined);
    const resumeAfterEnd = voipClient.currentCalls.find((call) => call.callId !== callRef.current?.callId && call.currentState === TelnyxCallState.HELD);
    if (callId) {
      try {
        await terminateCall(callId, routeId);
      } catch (failure) {
        reportVoiceError('end call', failure);
        setError('Hangup was not acknowledged. Tap end call to retry.');
        throw failure;
      }
    }
    finalizeCall('ended', callId);
    activeCallRef.current = null;
    durationRef.current = 0;
    setActiveCall(null);
    setDuration(0);
    if (resumeAfterEnd) {
      await resumeAfterEnd.resume().catch((failure) => reportVoiceError('resume remaining line after hangup', failure));
      voipClient.setActiveCall(resumeAfterEnd.callId);
      attachCall(resumeAfterEnd);
      return;
    }
  }, [activeCall?.id, activeCall?.routeId, attachCall, cancelRoutePolling, finalizeCall, reportVoiceError, stopRingback, terminateCall]);

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
      durationRef.current = 0;
      setDuration(0);
    } catch (answerError) {
      setActiveCall((current) => current?.id === call.callId ? { ...current, phase: 'ringing' } : current);
      setError(answerError instanceof Error ? answerError.message : 'The incoming call could not be answered.');
      throw answerError;
    }
  }, []);
  const toggleMute = useCallback(async () => {
    if (callRef.current) await callRef.current.toggleMute();
    else setActiveCall((current) => current ? { ...current, muted: !current.muted } : current);
  }, []);
  const toggleHold = useCallback(async () => {
    if (callRef.current) callRef.current.currentIsHeld ? await callRef.current.resume() : await callRef.current.hold();
    else setActiveCall((current) => current ? { ...current, onHold: !current.onHold } : current);
  }, []);
  const toggleSpeaker = useCallback(async () => {
    try {
      const speaker = await VoicePnBridge.toggleSpeaker();
      setActiveCall((current) => current ? { ...current, speaker } : current);
    } catch (failure) {
      reportVoiceError('toggle speaker', failure);
      throw failure;
    }
  }, [reportVoiceError]);
  const sendDtmf = useCallback(async (digit: string) => { if (callRef.current) await callRef.current.dtmf(digit); }, []);

  const value = useMemo(() => ({ connection, activeCall, waitingCall, heldCall, conference, duration, error, isReady: isPreview || connection === TelnyxConnectionState.CONNECTED, pushRegistration, refreshIncomingCalls, startCall, startSecondCall, startInternalCall, transferCall, answerWaitingCall, rejectWaitingCall, swapCalls, mergeCalls, removeConferenceParticipant, endCall, answerCall, toggleMute, toggleHold, toggleSpeaker, sendDtmf }), [activeCall, answerCall, answerWaitingCall, conference, connection, duration, endCall, error, heldCall, isPreview, mergeCalls, pushRegistration, refreshIncomingCalls, rejectWaitingCall, removeConferenceParticipant, sendDtmf, startCall, startInternalCall, startSecondCall, swapCalls, toggleHold, toggleMute, toggleSpeaker, transferCall, waitingCall]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function VoiceRoot({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated, isPreview } = useAuth();
  const [bootstrapSession, setBootstrapSession] = useState<VoiceLoginConfig | null>(null);

  useEffect(() => {
    if (isPreview || (!loading && !isAuthenticated)) {
      setBootstrapSession(null);
      return;
    }
    let canceled = false;
    const prepare = async () => {
      try {
        const launchedFromPush = await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (!launchedFromPush || canceled) return;
        const ringtone = await loadIncomingRingtone();
        const storedSession = await loadVoiceSession();
        const session: VoiceLoginConfig = isVoiceSessionFresh(storedSession, 30_000)
          ? { ...storedSession, ringtone }
          : isAuthenticated
            ? voiceLoginConfig(await api.post<VoiceTokenResponse>('/api/telnyx/token', {}), ringtone)
            : (() => { throw new Error('The cached calling token expired before the account session was restored.'); })();
        await Promise.all([applyIncomingRingtone(ringtone), persistVoiceSession(session)]);
        if (!canceled) setBootstrapSession(session);
      } catch (failure) {
        const normalized = failure instanceof Error ? failure : new Error(String(failure));
        console.error('[Vocivo Voice] killed-state session bootstrap failed', { message: normalized.message, stack: normalized.stack });
      }
    };
    prepare();
    return () => { canceled = true; };
  }, [isAuthenticated, isPreview, loading]);

  // Mount the native Telnyx runtime on the first render. PushKit and Android
  // Telecom actions must not wait behind the visual account bootstrap.
  return <TelnyxVoiceApp voipClient={voipClient} enableAutoReconnect debug={__DEV__}><VoiceProvider bootstrapSession={bootstrapSession}>{children}</VoiceProvider></TelnyxVoiceApp>;
}

export function useVoice() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('useVoice must be used inside VoiceRoot');
  return value;
}
