import { useCallback, useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { api } from '../lib/api';

const TERMINAL_STATES = new Set(['hangup', 'destroy', 'purge']);

export function useTelnyxVoice(token, enabled) {
  const clientRef = useRef(null);
  const callRef = useRef(null);
  const endedIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting...');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [endedCall, setEndedCall] = useState(null);

  const disconnect = useCallback(() => {
    try { callRef.current?.hangup?.(); } catch { /* already closed */ }
    try { clientRef.current?.disconnect?.(); } catch { /* already disconnected */ }
    clientRef.current = null;
    callRef.current = null;
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setState(null);
  }, []);

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
        setState(nextState);
        if (direction === 'inbound' && ['new', 'ringing', 'early', 'requesting'].includes(nextState)) setIncomingCall(updatedCall);
        if (['active', 'held'].includes(nextState)) setIncomingCall(null);
        if (TERMINAL_STATES.has(nextState)) {
          const callId = updatedCall.id || updatedCall.callId || `${Date.now()}`;
          if (endedIdRef.current !== callId) {
            endedIdRef.current = callId;
            const number = direction === 'inbound'
              ? updatedCall.options?.remoteCallerNumber || updatedCall.options?.callerNumber
              : updatedCall.options?.destinationNumber || updatedCall.options?.remoteCallerNumber;
            setEndedCall({ id: callId, number: number || 'Unknown', direction: direction === 'inbound' ? 'incoming' : 'outgoing' });
          }
          callRef.current = null;
          setCall(null);
          setIncomingCall(null);
          setState(null);
          setMuted(false);
        }
      });
      client.connect();
    }).catch((connectionError) => {
      if (cancelled) return;
      setError(connectionError.message);
      setStatusLabel('Unable to connect');
    });
    return () => { cancelled = true; disconnect(); };
  }, [disconnect, enabled, token]);

  const startCall = useCallback(async (destinationNumber, callerNumber) => {
    setError('');
    setDialedNumber(destinationNumber);
    try {
      const newCall = clientRef.current?.newCall({
        destinationNumber,
        callerNumber,
        callerName: 'Vocivo',
        customHeaders: [
          { name: 'X-Vocivo-Flow', value: 'outbound' },
          { name: 'X-Vocivo-Destination', value: destinationNumber },
          ...(callerNumber ? [{ name: 'X-Vocivo-Caller-ID', value: callerNumber }] : []),
        ],
        remoteElement: 'remoteMedia',
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        trickleIce: true,
      });
      if (!newCall) throw new Error('The web phone is not ready yet.');
      callRef.current = newCall;
      setCall(newCall);
      setState(String(newCall.state || 'requesting').toLowerCase());
    } catch (callError) {
      setError(callError.message || 'The call could not be started. Check microphone permission.');
    }
  }, []);

  const answer = useCallback(async () => {
    try {
      await callRef.current?.answer?.({ remoteElement: 'remoteMedia', audio: true });
      setIncomingCall(null);
    } catch (answerError) { setError(answerError.message || 'The call could not be answered.'); }
  }, []);
  const decline = useCallback(() => { callRef.current?.hangup?.(); setIncomingCall(null); }, []);
  const hangup = useCallback(() => callRef.current?.hangup?.(), []);
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
    ready, statusLabel, error, call, incomingCall, state, muted, dialedNumber, endedCall,
    active: ['requesting', 'trying', 'ringing', 'answering', 'early', 'active', 'held', 'recovering'].includes(state) && !incomingCall,
    startCall, answer, decline, hangup, toggleMute, toggleHold, disconnect,
  };
}
