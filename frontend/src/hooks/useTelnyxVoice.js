import { useCallback, useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { api } from '../lib/api';

const TERMINAL_STATES = new Set(['hangup', 'destroy', 'purge']);

function callHeader(call, name) {
  const headers = call?.options?.customHeaders || call?.options?.dialogParams?.customHeaders || [];
  const header = headers.find((item) => String(item?.name || item?.header_name || '').toLowerCase() === name.toLowerCase());
  return header?.value || header?.header_value;
}

function describeRemote(call, fallbackNumber = '') {
  const rawNumber = call?.options?.remoteCallerNumber || call?.options?.callerNumber || call?.options?.destinationNumber || fallbackNumber;
  const rawName = call?.options?.remoteCallerName || call?.options?.callerName || '';
  const displayMatch = String(rawName).trim().match(/^(.+?)\s*-\s*Ext(?:ension)?\s+(\d{2,5})$/i);
  const extension = callHeader(call, 'X-Vocivo-Caller-Extension') || displayMatch?.[2];
  const employeeName = callHeader(call, 'X-Vocivo-Caller-Name') || displayMatch?.[1];
  const safeNumber = String(rawNumber || '').startsWith('sip:') ? 'Internal call' : rawNumber;
  return {
    name: employeeName || rawName || (extension ? 'Company colleague' : 'Phone call'),
    number: extension ? `Extension ${extension}` : safeNumber || 'Unknown caller',
    internal: Boolean(extension || callHeader(call, 'X-Vocivo-Call-Type') === 'internal'),
    photoUrl: callHeader(call, 'X-Vocivo-Caller-Photo') || '',
  };
}

function getCallId(call) {
  return call?.id || call?.callId || '';
}

export function useTelnyxVoice(token, enabled, identity = {}) {
  const clientRef = useRef(null);
  const clientListenerCleanupRef = useRef(null);
  const iceServersRef = useRef(undefined);
  const tokenRefreshRef = useRef(null);
  const callRef = useRef(null);
  const endedIdRef = useRef(null);
  const routeIdRef = useRef(null);
  const routePollRef = useRef(0);
  const callIdentityRef = useRef(new Map());
  const locallyEndedCallIdsRef = useRef(new Set());
  const incomingToneRef = useRef(null);
  const incomingNotificationRef = useRef(null);
  const incomingCallRef = useRef(null);
  const heldCallRef = useRef(null);
  const conferenceRef = useRef(null);
  const callActionBusyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting...');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [heldCall, setHeldCall] = useState(null);
  const [conference, setConference] = useState(null);
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [endedCall, setEndedCall] = useState(null);
  const [routePhase, setRoutePhase] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [remoteIdentity, setRemoteIdentity] = useState({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [loginGeneration, setLoginGeneration] = useState(0);

  const resumeAudio = useCallback(async () => {
    const media = document.getElementById('remoteMedia');
    if (!media?.play) return;
    try {
      await media.play();
      setAudioBlocked(false);
    } catch (playbackError) {
      setAudioBlocked(true);
      throw playbackError;
    }
  }, []);

  // The parked Telnyx leg supplies ringback. A second browser loop can survive
  // the bridge event and overlap the connected call audio.
  const stopRingback = useCallback(() => undefined, []);
  const startRingback = useCallback(() => undefined, []);
  const stopIncomingRingtone = useCallback(() => {
    const tone = incomingToneRef.current;
    incomingToneRef.current = null;
    if (tone) {
      tone.pause();
      tone.currentTime = 0;
    }
    incomingNotificationRef.current?.close?.();
    incomingNotificationRef.current = null;
    navigator.vibrate?.(0);
  }, []);
  const startIncomingRingtone = useCallback((incoming) => {
    if (!incomingToneRef.current) {
      const tone = new Audio('/audio/ringback.wav');
      tone.loop = true;
      tone.volume = 0.72;
      incomingToneRef.current = tone;
      tone.play().catch(() => undefined);
    }
    navigator.vibrate?.([450, 250, 450, 650]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && !incomingNotificationRef.current) {
      const identity = describeRemote(incoming);
      const notification = new Notification(identity.name || 'Incoming Vocivo call', {
        body: identity.number || 'Open Vocivo to answer',
        icon: '/vocivo-icon-192.png',
        tag: `vocivo-incoming-${incoming.id || incoming.callId || 'call'}`,
        requireInteraction: true,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      incomingNotificationRef.current = notification;
    }
  }, []);
  const enableBrowserAlerts = useCallback(async () => {
    const probe = new Audio('/audio/ringback.wav');
    probe.volume = 0.01;
    await probe.play().catch(() => undefined);
    probe.pause();
    probe.currentTime = 0;
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    return permission;
  }, []);

  const disconnect = useCallback(() => {
    if (tokenRefreshRef.current) {
      clearTimeout(tokenRefreshRef.current);
      tokenRefreshRef.current = null;
    }
    const routeId = routeIdRef.current;
    const extraRoutes = [heldCallRef.current?.routeId, ...(conferenceRef.current?.participants || []).map((item) => item.routeId)].filter(Boolean);
    [...new Set([routeId, ...extraRoutes].filter(Boolean))].forEach((id) => api('/api/voice/cancel', { method: 'POST', body: { routeId: id } }).catch(() => undefined));
    try { callRef.current?.hangup?.(); } catch { /* already closed */ }
    try { heldCallRef.current?.call?.hangup?.(); } catch { /* already closed */ }
    clientListenerCleanupRef.current?.();
    clientListenerCleanupRef.current = null;
    try { clientRef.current?.disconnect?.(); } catch { /* already disconnected */ }
    clientRef.current = null;
    iceServersRef.current = undefined;
    callRef.current = null;
    incomingCallRef.current = null;
    heldCallRef.current = null;
    conferenceRef.current = null;
    routeIdRef.current = null;
    routePollRef.current += 1;
    stopRingback();
    stopIncomingRingtone();
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setHeldCall(null);
    setConference(null);
    setState(null);
    setRoutePhase(null);
  }, [stopIncomingRingtone, stopRingback]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    setStatusLabel('Connecting...');
    setError('');
    api('/api/telnyx/token', { method: 'POST', body: {} }).then(({ token: loginToken, expires_in: expiresIn = 3600, ice_servers: iceServers = [] }) => {
      if (cancelled) return;
      if (!loginToken) throw new Error('The calling service did not return a session token.');
      const refreshWhenIdle = () => {
        if (cancelled) return;
        if (callRef.current || incomingCallRef.current || heldCallRef.current) {
          tokenRefreshRef.current = setTimeout(refreshWhenIdle, 60_000);
          return;
        }
        setLoginGeneration((generation) => generation + 1);
      };
      const lifetimeSeconds = Number.isFinite(Number(expiresIn)) ? Number(expiresIn) : 3600;
      tokenRefreshRef.current = setTimeout(refreshWhenIdle, Math.max(30, lifetimeSeconds - 120) * 1000);
      iceServersRef.current = Array.isArray(iceServers) && iceServers.length ? iceServers : undefined;
      const client = new TelnyxRTC({ login_token: loginToken, iceServers: iceServersRef.current, trickleIce: true });
      clientRef.current = client;
      client.remoteElement = 'remoteMedia';
      const listeners = [];
      const on = (event, listener) => {
        client.on(event, listener);
        listeners.push([event, listener]);
      };
      clientListenerCleanupRef.current = () => {
        listeners.splice(0).forEach(([event, listener]) => client.off(event, listener));
      };
      on('telnyx.ready', () => {
        if (cancelled) return;
        setReady(true);
        setStatusLabel('Ready for calls');
      });
      on('telnyx.error', (event) => {
        if (cancelled) return;
        setError(event?.message || 'The web phone could not connect.');
        setStatusLabel('Connection problem');
      });
      on('telnyx.socket.close', () => {
        if (cancelled) return;
        const routeIds = [
          routeIdRef.current,
          heldCallRef.current?.routeId,
          ...(conferenceRef.current?.participants || []).map((participant) => participant.routeId),
        ].filter(Boolean);
        [...new Set(routeIds)].forEach((routeId) => {
          api('/api/voice/cancel', { method: 'POST', body: { routeId } }).catch(() => undefined);
        });
        routePollRef.current += 1;
        routeIdRef.current = null;
        callRef.current = null;
        incomingCallRef.current = null;
        heldCallRef.current = null;
        conferenceRef.current = null;
        stopRingback();
        stopIncomingRingtone();
        setCall(null);
        setIncomingCall(null);
        setHeldCall(null);
        setConference(null);
        setState(null);
        setMuted(false);
        setRoutePhase(null);
        setRemoteIdentity({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
        setAudioBlocked(false);
        setReady(false);
        setStatusLabel('Reconnecting...');
      });
      on('telnyx.notification', (notification) => {
        if (cancelled || notification?.type !== 'callUpdate' || !notification.call) return;
        const updatedCall = notification.call;
        const nextState = String(updatedCall.state || '').toLowerCase();
        const direction = String(updatedCall.direction || updatedCall.options?.direction || '').toLowerCase();
        const callId = updatedCall.id || updatedCall.callId;
        if (callId && locallyEndedCallIdsRef.current.has(callId) && !TERMINAL_STATES.has(nextState)) {
          try { updatedCall.hangup?.(); } catch { /* already closing */ }
          return;
        }
        const activeId = getCallId(callRef.current);
        const heldId = heldCallRef.current?.id;
        if (callId && heldId === callId && activeId !== callId) {
          if (TERMINAL_STATES.has(nextState)) {
            heldCallRef.current = null;
            setHeldCall(null);
          } else {
            const nextHeld = { ...heldCallRef.current, call: updatedCall, state: nextState };
            heldCallRef.current = nextHeld;
            setHeldCall(nextHeld);
          }
          return;
        }
        if (direction === 'inbound' && ['new', 'ringing', 'early', 'requesting'].includes(nextState) && activeId && activeId !== callId) {
          incomingCallRef.current = updatedCall;
          setIncomingCall(updatedCall);
          startIncomingRingtone(updatedCall);
          return;
        }
        if (callId && activeId && activeId !== callId && TERMINAL_STATES.has(nextState)) {
          if (getCallId(incomingCallRef.current) === callId) {
            incomingCallRef.current = null;
            setIncomingCall(null);
            stopIncomingRingtone();
          }
          callIdentityRef.current.delete(callId);
          return;
        }
        if (activeId && activeId !== callId && !TERMINAL_STATES.has(nextState)) return;
        callRef.current = updatedCall;
        setCall(updatedCall);
        setRemoteIdentity(callIdentityRef.current.get(callId) || describeRemote(updatedCall, dialedNumber));
        setState(nextState);
        if (direction === 'inbound' && ['new', 'ringing', 'early', 'requesting'].includes(nextState)) {
          incomingCallRef.current = updatedCall;
          setIncomingCall(updatedCall);
          startIncomingRingtone(updatedCall);
        }
        if (['active', 'held'].includes(nextState)) {
          incomingCallRef.current = null;
          setIncomingCall(null);
          stopIncomingRingtone();
          resumeAudio().catch(() => undefined);
        }
        if (TERMINAL_STATES.has(nextState)) {
          if (callId) locallyEndedCallIdsRef.current.delete(callId);
          routePollRef.current += 1;
          routeIdRef.current = null;
          setRoutePhase(null);
          stopRingback();
          stopIncomingRingtone();
          const endedCallId = callId || `${Date.now()}`;
          if (endedIdRef.current !== endedCallId) {
            endedIdRef.current = endedCallId;
            const localIdentity = callIdentityRef.current.get(endedCallId);
            const number = localIdentity?.number || (direction === 'inbound'
              ? updatedCall.options?.remoteCallerNumber || updatedCall.options?.callerNumber
              : updatedCall.options?.destinationNumber || updatedCall.options?.remoteCallerNumber);
            setEndedCall({ id: endedCallId, number: number || 'Unknown', direction: direction === 'inbound' ? 'incoming' : 'outgoing' });
          }
          callRef.current = null;
          incomingCallRef.current = null;
          callIdentityRef.current.delete(endedCallId);
          setCall(null);
          setIncomingCall(null);
          setState(null);
          setMuted(false);
          setRemoteIdentity({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
          const held = heldCallRef.current;
          if (held && !conferenceRef.current) {
            heldCallRef.current = null;
            setHeldCall(null);
            Promise.resolve(held.call?.unhold?.()).then(() => {
              callRef.current = held.call;
              routeIdRef.current = held.routeId || null;
              setCall(held.call);
              setState('active');
              setRoutePhase('connected');
              setRemoteIdentity(held.identity);
            }).catch(() => undefined);
          } else if (conferenceRef.current) {
            conferenceRef.current = null;
            setConference(null);
          }
        }
      });
      client.connect();
    }).catch((connectionError) => {
      if (cancelled) return;
      setError(connectionError.message);
      setStatusLabel('Unable to connect');
    });
    return () => { cancelled = true; disconnect(); };
  }, [disconnect, enabled, loginGeneration, resumeAudio, startIncomingRingtone, stopIncomingRingtone, stopRingback, token]);

  const followRoute = useCallback(async (routeId) => {
    const generation = ++routePollRef.current;
    routeIdRef.current = routeId;
    setRoutePhase('ringing');
    for (let attempt = 0; attempt < 100 && routePollRef.current === generation; attempt += 1) {
      try {
        const result = await api(`/api/voice/status?routeId=${encodeURIComponent(routeId)}`);
        if (routePollRef.current !== generation) return;
        if (result.phase === 'connected') {
          setRoutePhase('connected');
          stopRingback();
          resumeAudio().catch(() => undefined);
          return;
        }
        if (['failed', 'ended'].includes(result.phase)) {
          setRoutePhase(result.phase);
          stopRingback();
          if (result.failureCause) setError(`Call ended: ${String(result.failureCause).replaceAll('_', ' ')}.`);
          try { callRef.current?.hangup?.(); } catch { /* already closed */ }
          return;
        }
      } catch (routeError) {
        if (attempt > 8) {
          setError(routeError.message || 'Call status could not be confirmed.');
          stopRingback();
          try { callRef.current?.hangup?.(); } catch { /* already closed */ }
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (routePollRef.current === generation) {
      stopRingback();
      setError('Call setup timed out. Please try again.');
      try { callRef.current?.hangup?.(); } catch { /* already closed */ }
    }
  }, [resumeAudio, stopRingback]);

  const startCall = useCallback(async (destinationNumber, callerNumber) => {
    setError('');
    setDialedNumber(destinationNumber);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 10)}`;
    startRingback();
    try {
      const reservation = await api('/api/voice/route', { method: 'POST', body: { routeId, destination: destinationNumber, callerId: callerNumber, flow: 'outbound' } });
      const newCall = clientRef.current?.newCall({
        destinationNumber,
        callerNumber: reservation.callerId,
        callerName: identity.name || 'Vocivo',
        customHeaders: [
          { name: 'X-Vocivo-Flow', value: 'outbound' },
          { name: 'X-Vocivo-Destination', value: destinationNumber },
          { name: 'X-Vocivo-Route-ID', value: routeId },
          { name: 'X-Vocivo-Route-Token', value: reservation.routeToken },
          ...(reservation.callerId ? [{ name: 'X-Vocivo-Caller-ID', value: reservation.callerId }] : []),
        ],
        remoteElement: 'remoteMedia',
        ...(iceServersRef.current ? { iceServers: iceServersRef.current } : {}),
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        trickleIce: true,
      });
      if (!newCall) throw new Error('The web phone is not ready yet.');
      callRef.current = newCall;
      incomingCallRef.current = null;
      callIdentityRef.current.set(newCall.id || newCall.callId, { name: 'Outbound call', number: destinationNumber, internal: false });
      setCall(newCall);
      setRemoteIdentity({ name: 'Outbound call', number: destinationNumber, internal: false, photoUrl: '' });
      setState(String(newCall.state || 'requesting').toLowerCase());
      followRoute(routeId);
    } catch (callError) {
      stopRingback();
      setError(callError.message || 'The call could not be started. Check microphone permission.');
      throw callError;
    }
  }, [followRoute, identity.name, startRingback, stopRingback]);

  const startInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    const destination = `sip:${sipUsername}@sip.telnyx.com`;
    setDialedNumber(extension);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 10)}`;
    startRingback();
    try {
      const reservation = await api('/api/voice/route', { method: 'POST', body: { routeId, destination, flow: 'internal' } });
      const newCall = clientRef.current?.newCall({
        destinationNumber: destination,
        callerName: reservation.callerName || identity.name || 'Vocivo',
        callerNumber: reservation.callerExtension || identity.extension,
        customHeaders: [
          { name: 'X-Vocivo-Flow', value: 'internal' },
          { name: 'X-Vocivo-Destination', value: destination },
          { name: 'X-Vocivo-Route-ID', value: routeId },
          { name: 'X-Vocivo-Route-Token', value: reservation.routeToken },
        ],
        remoteElement: 'remoteMedia',
        ...(iceServersRef.current ? { iceServers: iceServersRef.current } : {}),
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        trickleIce: true,
      });
      if (!newCall) throw new Error('The web phone is not ready yet.');
      callRef.current = newCall;
      incomingCallRef.current = null;
      callIdentityRef.current.set(newCall.id || newCall.callId, { name: displayName, number: `Extension ${extension}`, internal: true });
      setCall(newCall);
      setRemoteIdentity({ name: displayName, number: `Extension ${extension}`, internal: true, photoUrl: '' });
      setState(String(newCall.state || 'requesting').toLowerCase());
      followRoute(routeId);
    } catch (callError) {
      stopRingback();
      setError(callError.message || 'The extension call could not be started.');
      throw callError;
    }
  }, [followRoute, identity.extension, identity.name, startRingback, stopRingback]);

  const answer = useCallback(async () => {
    try {
      stopIncomingRingtone();
      const incoming = incomingCallRef.current || incomingCall;
      const current = callRef.current;
      if (!incoming) return;
      if (current && getCallId(current) !== getCallId(incoming) && ['active', 'held'].includes(String(current.state || '').toLowerCase())) {
        const snapshot = { id: getCallId(current), call: current, identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' };
        heldCallRef.current = snapshot;
        setHeldCall(snapshot);
        await current.hold?.();
      }
      await incoming.answer?.({ remoteElement: 'remoteMedia', ...(iceServersRef.current ? { iceServers: iceServersRef.current } : {}), audio: true });
      callRef.current = incoming;
      incomingCallRef.current = null;
      routeIdRef.current = null;
      setCall(incoming);
      setState('answering');
      setRoutePhase(null);
      setRemoteIdentity(callIdentityRef.current.get(getCallId(incoming)) || describeRemote(incoming));
      await resumeAudio().catch(() => undefined);
      setIncomingCall(null);
    } catch (answerError) { setError(answerError.message || 'The call could not be answered.'); }
  }, [incomingCall, remoteIdentity, resumeAudio, stopIncomingRingtone]);
  const decline = useCallback(() => {
    stopIncomingRingtone();
    const incoming = incomingCallRef.current || incomingCall;
    incoming?.hangup?.();
    incomingCallRef.current = null;
    setIncomingCall(null);
    if (getCallId(callRef.current) === getCallId(incoming)) {
      callRef.current = null;
      setCall(null);
      setState(null);
    }
  }, [incomingCall, stopIncomingRingtone]);
  const hangup = useCallback(() => {
    const routeId = routeIdRef.current;
    const current = callRef.current;
    const held = heldCallRef.current;
    const extraRoutes = [held?.routeId, ...(conferenceRef.current?.participants || []).map((item) => item.routeId)].filter(Boolean);
    const callId = current?.id || current?.callId;
    if (callId) locallyEndedCallIdsRef.current.add(callId);
    routePollRef.current += 1;
    routeIdRef.current = null;
    stopRingback();
    stopIncomingRingtone();
    [...new Set([routeId, ...extraRoutes].filter(Boolean))].forEach((id) => api('/api/voice/cancel', { method: 'POST', body: { routeId: id } }).catch(() => undefined));
    try { current?.hangup?.(); } catch { /* already closed */ }
    try { held?.call?.hangup?.(); } catch { /* already closed */ }
    callRef.current = null;
    incomingCallRef.current = null;
    heldCallRef.current = null;
    conferenceRef.current = null;
    setCall(null);
    setIncomingCall(null);
    setHeldCall(null);
    setConference(null);
    setState(null);
    setMuted(false);
    setRoutePhase('ended');
  }, [stopIncomingRingtone, stopRingback]);
  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    if (muted) callRef.current.unmuteAudio?.(); else callRef.current.muteAudio?.();
    setMuted((value) => !value);
  }, [muted]);
  const toggleHold = useCallback(() => {
    if (!callRef.current) return;
    if (state === 'held') callRef.current.unhold?.(); else callRef.current.hold?.();
  }, [state]);

  const startSecondCall = useCallback(async (destinationNumber, callerNumber) => {
    const current = callRef.current;
    if (!current || !['active'].includes(String(current.state || '').toLowerCase()) || heldCallRef.current || conferenceRef.current) throw new Error('Connect the first call before adding another caller.');
    const snapshot = { id: getCallId(current), call: current, identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' };
    heldCallRef.current = snapshot;
    setHeldCall(snapshot);
    await current.hold?.();
    try {
      await startCall(destinationNumber, callerNumber);
    } catch (secondCallError) {
      heldCallRef.current = null;
      setHeldCall(null);
      await current.unhold?.();
      callRef.current = current;
      routeIdRef.current = snapshot.routeId;
      setCall(current);
      setState('active');
      setRoutePhase('connected');
      setRemoteIdentity(snapshot.identity);
      throw secondCallError;
    }
  }, [remoteIdentity, startCall]);

  const startSecondInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    const current = callRef.current;
    if (!current || String(current.state || '').toLowerCase() !== 'active' || heldCallRef.current || conferenceRef.current) throw new Error('Connect the first call before adding another caller.');
    const snapshot = { id: getCallId(current), call: current, identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' };
    heldCallRef.current = snapshot;
    setHeldCall(snapshot);
    await current.hold?.();
    try {
      await startInternalCall(sipUsername, extension, displayName);
    } catch (secondCallError) {
      heldCallRef.current = null;
      setHeldCall(null);
      await current.unhold?.();
      callRef.current = current;
      routeIdRef.current = snapshot.routeId;
      setCall(current);
      setState('active');
      setRoutePhase('connected');
      setRemoteIdentity(snapshot.identity);
      throw secondCallError;
    }
  }, [remoteIdentity, startInternalCall]);

  const swapCalls = useCallback(async () => {
    if (callActionBusyRef.current) throw new Error('Another call action is still completing.');
    const current = callRef.current;
    const held = heldCallRef.current;
    if (!current || !held || conferenceRef.current) throw new Error('There is no held call to swap.');
    callActionBusyRef.current = true;
    const currentSnapshot = { id: getCallId(current), call: current, identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' };
    try {
      await current.hold?.();
      await held.call?.unhold?.();
      heldCallRef.current = currentSnapshot;
      setHeldCall(currentSnapshot);
      callRef.current = held.call;
      routeIdRef.current = held.routeId || null;
      setCall(held.call);
      setState('active');
      setRoutePhase('connected');
      setRemoteIdentity(held.identity);
    } finally {
      callActionBusyRef.current = false;
    }
  }, [remoteIdentity]);

  const mergeCalls = useCallback(async () => {
    if (callActionBusyRef.current) throw new Error('Another call action is still completing.');
    const active = callRef.current;
    const held = heldCallRef.current;
    if (!active || !held || !routeIdRef.current || !held.routeId) throw new Error('Two connected Vocivo calls are required before merging.');
    callActionBusyRef.current = true;
    try {
      const result = await api('/api/voice/merge', { method: 'POST', body: { routeIds: [routeIdRef.current, held.routeId] } });
      const merged = {
        id: result.conferenceId,
        participants: [
          { id: held.id, routeId: held.routeId, ...held.identity },
          { id: getCallId(active), routeId: routeIdRef.current, ...remoteIdentity },
        ],
      };
      conferenceRef.current = merged;
      setConference(merged);
      heldCallRef.current = null;
      setHeldCall(null);
    } finally {
      callActionBusyRef.current = false;
    }
  }, [remoteIdentity]);

  const removeConferenceParticipant = useCallback(async (participantId) => {
    const current = conferenceRef.current;
    const participant = current?.participants.find((item) => item.id === participantId);
    if (!current || !participant?.routeId || current.participants[0]?.id === participantId) throw new Error('Only an added participant can be removed.');
    await api('/api/voice/merge', { method: 'POST', body: { action: 'remove_participant', conferenceId: current.id, routeId: participant.routeId } });
    const next = { ...current, participants: current.participants.filter((item) => item.id !== participantId) };
    if (participantId === getCallId(callRef.current) && next.participants[0]) {
      routeIdRef.current = next.participants[0].routeId || null;
      setRemoteIdentity(next.participants[0]);
    }
    conferenceRef.current = next;
    setConference(next);
  }, []);

  const transferCall = useCallback(async (targetExtensionId) => {
    await api('/api/voice/transfer', { method: 'POST', body: { targetExtensionId } });
  }, []);

  const sendDtmf = useCallback((digit) => callRef.current?.dtmf?.(digit), []);

  return {
    ready, statusLabel, error, call, incomingCall, heldCall, conference, remoteIdentity, state: routePhase === 'connected' ? 'active' : routePhase || state, muted, dialedNumber, endedCall,
    connected: routePhase ? routePhase === 'connected' : state === 'active',
    active: (routePhase ? ['ringing', 'connected'].includes(routePhase) : ['requesting', 'trying', 'ringing', 'answering', 'early', 'active', 'held', 'recovering'].includes(state)) && !incomingCall,
    notificationPermission, enableBrowserAlerts, audioBlocked, resumeAudio,
    startCall, startInternalCall, startSecondCall, startSecondInternalCall, swapCalls, mergeCalls, removeConferenceParticipant, transferCall, sendDtmf, answer, decline, hangup, toggleMute, toggleHold, disconnect,
  };
}
