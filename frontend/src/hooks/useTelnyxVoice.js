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
  };
}

export function useTelnyxVoice(token, enabled, identity = {}) {
  const clientRef = useRef(null);
  const callRef = useRef(null);
  const endedIdRef = useRef(null);
  const routeIdRef = useRef(null);
  const routePollRef = useRef(0);
  const callIdentityRef = useRef(new Map());
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting...');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [endedCall, setEndedCall] = useState(null);
  const [routePhase, setRoutePhase] = useState(null);
  const [remoteIdentity, setRemoteIdentity] = useState({ name: 'Phone call', number: '', internal: false });

  // The parked Telnyx leg supplies ringback. A second browser loop can survive
  // the bridge event and overlap the connected call audio.
  const stopRingback = useCallback(() => undefined, []);
  const startRingback = useCallback(() => undefined, []);

  const disconnect = useCallback(() => {
    try { callRef.current?.hangup?.(); } catch { /* already closed */ }
    try { clientRef.current?.disconnect?.(); } catch { /* already disconnected */ }
    clientRef.current = null;
    callRef.current = null;
    routeIdRef.current = null;
    routePollRef.current += 1;
    stopRingback();
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setState(null);
    setRoutePhase(null);
  }, [stopRingback]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    setStatusLabel('Connecting...');
    setError('');
    api('/api/telnyx/config').then(({ sip_user: login, sip_password: password }) => {
      if (cancelled) return;
      const client = new TelnyxRTC({ login, password });
      clientRef.current = client;
      client.remoteElement = 'remoteMedia';
      client.on('telnyx.ready', () => {
        if (cancelled) return;
        setReady(true);
        setStatusLabel('Ready for calls');
      });
      client.on('telnyx.error', (event) => {
        if (cancelled) return;
        setError(event?.message || 'The web phone could not connect.');
        setStatusLabel('Connection problem');
      });
      client.on('telnyx.socket.close', () => {
        if (cancelled) return;
        setReady(false);
        setStatusLabel('Reconnecting...');
      });
      client.on('telnyx.notification', (notification) => {
        if (cancelled || notification?.type !== 'callUpdate' || !notification.call) return;
        const updatedCall = notification.call;
        const nextState = String(updatedCall.state || '').toLowerCase();
        const direction = String(updatedCall.direction || updatedCall.options?.direction || '').toLowerCase();
        callRef.current = updatedCall;
        setCall(updatedCall);
        const callId = updatedCall.id || updatedCall.callId;
        setRemoteIdentity(callIdentityRef.current.get(callId) || describeRemote(updatedCall, dialedNumber));
        setState(nextState);
        if (direction === 'inbound' && ['new', 'ringing', 'early', 'requesting'].includes(nextState)) setIncomingCall(updatedCall);
        if (['active', 'held'].includes(nextState)) setIncomingCall(null);
        if (TERMINAL_STATES.has(nextState)) {
          routePollRef.current += 1;
          routeIdRef.current = null;
          setRoutePhase(null);
          stopRingback();
          const callId = updatedCall.id || updatedCall.callId || `${Date.now()}`;
          if (endedIdRef.current !== callId) {
            endedIdRef.current = callId;
            const localIdentity = callIdentityRef.current.get(callId);
            const number = localIdentity?.number || (direction === 'inbound'
              ? updatedCall.options?.remoteCallerNumber || updatedCall.options?.callerNumber
              : updatedCall.options?.destinationNumber || updatedCall.options?.remoteCallerNumber);
            setEndedCall({ id: callId, number: number || 'Unknown', direction: direction === 'inbound' ? 'incoming' : 'outgoing' });
          }
          callRef.current = null;
          callIdentityRef.current.delete(callId);
          setCall(null);
          setIncomingCall(null);
          setState(null);
          setMuted(false);
          setRemoteIdentity({ name: 'Phone call', number: '', internal: false });
        }
      });
      client.connect();
    }).catch((connectionError) => {
      if (cancelled) return;
      setError(connectionError.message);
      setStatusLabel('Unable to connect');
    });
    return () => { cancelled = true; disconnect(); };
  }, [disconnect, enabled, stopRingback, token]);

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
          document.getElementById('remoteMedia')?.play?.().catch?.(() => undefined);
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
  }, [stopRingback]);

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
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        trickleIce: true,
      });
      if (!newCall) throw new Error('The web phone is not ready yet.');
      callRef.current = newCall;
      callIdentityRef.current.set(newCall.id || newCall.callId, { name: 'Outbound call', number: destinationNumber, internal: false });
      setCall(newCall);
      setRemoteIdentity({ name: 'Outbound call', number: destinationNumber, internal: false });
      setState(String(newCall.state || 'requesting').toLowerCase());
      followRoute(routeId);
    } catch (callError) {
      stopRingback();
      setError(callError.message || 'The call could not be started. Check microphone permission.');
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
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        trickleIce: true,
      });
      if (!newCall) throw new Error('The web phone is not ready yet.');
      callRef.current = newCall;
      callIdentityRef.current.set(newCall.id || newCall.callId, { name: displayName, number: `Extension ${extension}`, internal: true });
      setCall(newCall);
      setRemoteIdentity({ name: displayName, number: `Extension ${extension}`, internal: true });
      setState(String(newCall.state || 'requesting').toLowerCase());
      followRoute(routeId);
    } catch (callError) {
      stopRingback();
      setError(callError.message || 'The extension call could not be started.');
    }
  }, [followRoute, identity.extension, identity.name, startRingback, stopRingback]);

  const answer = useCallback(async () => {
    try {
      await callRef.current?.answer?.({ remoteElement: 'remoteMedia', audio: true });
      setIncomingCall(null);
    } catch (answerError) { setError(answerError.message || 'The call could not be answered.'); }
  }, []);
  const decline = useCallback(() => { callRef.current?.hangup?.(); setIncomingCall(null); }, []);
  const hangup = useCallback(() => { routePollRef.current += 1; stopRingback(); callRef.current?.hangup?.(); }, [stopRingback]);
  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    if (muted) callRef.current.unmuteAudio?.(); else callRef.current.muteAudio?.();
    setMuted((value) => !value);
  }, [muted]);
  const toggleHold = useCallback(() => {
    if (!callRef.current) return;
    if (state === 'held') callRef.current.unhold?.(); else callRef.current.hold?.();
  }, [state]);

  return {
    ready, statusLabel, error, call, incomingCall, remoteIdentity, state: routePhase === 'connected' ? 'active' : routePhase || state, muted, dialedNumber, endedCall,
    connected: routePhase ? routePhase === 'connected' : state === 'active',
    active: ['requesting', 'trying', 'ringing', 'answering', 'early', 'active', 'held', 'recovering'].includes(state) && !incomingCall,
    startCall, startInternalCall, answer, decline, hangup, toggleMute, toggleHold, disconnect,
  };
}
