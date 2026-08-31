import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { registerWebPush } from '../lib/webPush';
import { reportWebVoiceError } from '../voice/telemetry';
import { sipTargetUri, sipUserFromUri } from '../voice/sipDial';
import { SessionState } from 'sip.js';
import { attachSipMedia, connectSipUserAgent, inviteSipTarget, sipSessionId } from '../voice/sipSession';
import { conferenceSipUri, referSipSession, setSipHeld, setSipMuted } from '../voice/sipCallControl';

export function useSipVoice(token, enabled, identity = {}) {
  const sessionRef = useRef(null);
  const incomingRef = useRef(null);
  const heldSessionRef = useRef(null);
  const heldRouteIdRef = useRef(null);
  const heldIdentityRef = useRef(null);
  const routeIdRef = useRef(null);
  const credentialsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting SIP…');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [heldCall, setHeldCall] = useState(null);
  const [conference, setConference] = useState(null);
  const [dialedNumber, setDialedNumber] = useState('');
  const [remoteIdentity, setRemoteIdentity] = useState({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
  const [callStarting, setCallStarting] = useState(false);
  const [routePhase, setRoutePhase] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [endedCall, setEndedCall] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const ringbackRef = useRef(null);

  const stopRingback = useCallback(() => {
    const tone = ringbackRef.current;
    ringbackRef.current = null;
    if (tone) {
      tone.pause();
      tone.currentTime = 0;
    }
  }, []);

  const startRingback = useCallback(() => {
    if (ringbackRef.current) return;
    const tone = new Audio('/audio/ringback.wav');
    tone.loop = true;
    tone.volume = 0.55;
    ringbackRef.current = tone;
    tone.play().catch((failure) => reportWebVoiceError('play outbound ringback', failure));
  }, []);

  const hangupSession = useCallback((session) => {
    stopRingback();
    try { session?.cancel?.(); } catch (failure) { reportWebVoiceError('SIP cancel', failure); }
    try { session?.reject?.(); } catch (failure) { reportWebVoiceError('SIP reject', failure); }
    try { session?.bye?.(); } catch (failure) { reportWebVoiceError('SIP bye', failure); }
  }, [stopRingback]);

  const identityName = identity.name;
  const identityRef = useRef(identityName);
  identityRef.current = identityName;

  const disconnect = useCallback(async () => {
    hangupSession(sessionRef.current);
    hangupSession(incomingRef.current);
    try { await credentialsRef.current?.registerer?.unregister(); } catch (failure) { reportWebVoiceError('SIP unregister', failure); }
    try { await credentialsRef.current?.userAgent?.stop(); } catch (failure) { reportWebVoiceError('SIP stop', failure); }
    credentialsRef.current = null;
    sessionRef.current = null;
    incomingRef.current = null;
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setState(null);
    setRoutePhase(null);
    setMediaReady(false);
  }, [hangupSession]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    setStatusLabel('Connecting SIP…');
    setError('');
    const connect = async () => {
      let lastError;
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const credentials = await api('/api/voice/sip-credentials', { method: 'POST', body: {} });
          if (cancelled) return;
          if (!credentials.wsUri) throw new Error('VOCIVO_SIP_WSS_URI is not configured.');
          const connection = await connectSipUserAgent({
            username: credentials.username,
            password: credentials.password,
            domain: credentials.domain,
            wsUri: credentials.wsUri,
            displayName: identityRef.current,
            iceServers: credentials.ice_servers,
            onInvite: (invitation) => {
              incomingRef.current = invitation;
              setIncomingCall(invitation);
              setRemoteIdentity({
                name: invitation.remoteIdentity?.displayName || 'Incoming call',
                number: String(invitation.remoteIdentity?.uri || ''),
                internal: true,
                photoUrl: '',
              });
              attachSipMedia(invitation);
            },
          });
          if (cancelled) {
            await connection.userAgent.stop();
            return;
          }
          credentialsRef.current = connection;
          setReady(true);
          setError('');
          setStatusLabel('Ready for calls');
          return;
        } catch (failure) {
          lastError = failure;
          reportWebVoiceError('SIP register', failure);
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      const message = lastError instanceof Error ? lastError.message : 'The SIP phone could not register.';
      setError(message.includes('WebSocket') ? 'The Vocivo phone lost its SIP connection. Retrying…' : message);
      setStatusLabel('SIP unavailable');
    };
    connect();
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [disconnect, enabled, token]);

  useEffect(() => {
    if (!enabled || !token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    registerWebPush().catch((failure) => reportWebVoiceError('register browser push subscription', failure));
  }, [enabled, token]);

  const beginOutgoing = useCallback((identity, dialed) => {
    setError('');
    setRemoteIdentity(identity);
    setDialedNumber(dialed || identity.number);
    setRoutePhase('ringing');
    setState('requesting');
    setMediaReady(false);
    setCallStarting(false);
    setCall({ id: `pending-${Date.now()}`, pending: true });
    startRingback();
  }, [startRingback]);

  const place = useCallback(async (destination, options) => {
    const userAgent = credentialsRef.current?.userAgent;
    if (!userAgent) throw new Error('The SIP phone is not registered yet.');
    const domain = credentialsRef.current?.userAgent?.configuration?.uri?.host || '';
    const target = sipTargetUri(destination, domain);
    const session = await inviteSipTarget(userAgent, target, options.headers || []);
    attachSipMedia(session);
    sessionRef.current = session;
    session.stateChange.addListener((next) => {
      if (next === SessionState.Establishing || next === 'Establishing' || next === SessionState.Early || next === 'Early') {
        setState('requesting');
        setRoutePhase('ringing');
        startRingback();
      }
      if (next === SessionState.Established || next === 'Established') {
        stopRingback();
        setState('active');
        setRoutePhase('connected');
        setMediaReady(true);
      }
      if (next === SessionState.Terminated || next === 'Terminated') {
        if (sessionRef.current !== session) return;
        stopRingback();
        const routeId = routeIdRef.current;
        if (routeId) api('/api/voice/cancel', { method: 'POST', body: { routeId } }).catch(() => undefined);
        setCall(null);
        setState(null);
        setRoutePhase('ended');
        setMediaReady(false);
        sessionRef.current = null;
        routeIdRef.current = null;
      }
    });
    setCall(session);
    setDialedNumber(options.dialedNumber || destination);
    setRemoteIdentity(options.identity);
    setState('requesting');
    setRoutePhase('ringing');
    setMediaReady(false);
    setCallStarting(false);
    return session;
  }, [startRingback, stopRingback]);

  const startCall = useCallback(async (destinationNumber, callerNumber) => {
    const identity = { name: 'Outbound call', number: destinationNumber, internal: false, photoUrl: '' };
    beginOutgoing(identity, destinationNumber);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    routeIdRef.current = routeId;
    try {
      const reservation = await api('/api/voice/route', { method: 'POST', body: { routeId, destination: destinationNumber, callerId: callerNumber, flow: 'outbound' } });
      await place(destinationNumber, {
        dialedNumber: destinationNumber,
        identity,
        headers: [
          `X-Vocivo-Flow: outbound`,
          `X-Vocivo-Route-ID: ${routeId}`,
          `X-Vocivo-Route-Token: ${reservation.routeToken}`,
          ...(reservation.callerId ? [`X-Vocivo-Caller-ID: ${reservation.callerId}`] : []),
        ],
      });
    } catch (callError) {
      stopRingback();
      setCallStarting(false);
      setCall(null);
      setRoutePhase(null);
      setError(callError.message || 'The call could not be started.');
      if (routeIdRef.current) api('/api/voice/cancel', { method: 'POST', body: { routeId: routeIdRef.current } }).catch(() => undefined);
      throw callError;
    }
  }, [beginOutgoing, place, stopRingback]);

  const startInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    const identity = { name: displayName || `Extension ${extension}`, number: `Extension ${extension}`, internal: true, photoUrl: '' };
    beginOutgoing(identity, extension);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    routeIdRef.current = routeId;
    try {
      const reservation = await api('/api/voice/route', {
        method: 'POST',
        body: {
          routeId,
              destination: sipUsername || '',
          targetExtension: extension,
          flow: 'internal',
        },
      });
      const targetUser = sipUserFromUri(reservation.destination) || String(sipUsername || '').trim();
      if (!targetUser) throw new Error('The extension route did not return a SIP destination.');
      await place(targetUser, {
        dialedNumber: extension,
        identity: { name: reservation.destinationName || displayName || `Extension ${extension}`, number: `Extension ${extension}`, internal: true, photoUrl: '' },
        headers: [
          `X-Vocivo-Flow: internal`,
          `X-Vocivo-Route-ID: ${routeId}`,
          `X-Vocivo-Route-Token: ${reservation.routeToken}`,
        ],
      });
    } catch (callError) {
      stopRingback();
      setCallStarting(false);
      setCall(null);
      setRoutePhase(null);
      setError(callError.message || 'The extension call could not be started.');
      if (routeIdRef.current) api('/api/voice/cancel', { method: 'POST', body: { routeId: routeIdRef.current } }).catch(() => undefined);
      throw callError;
    }
  }, [beginOutgoing, place, stopRingback]);

  const answer = useCallback(async () => {
    const incoming = incomingRef.current;
    if (!incoming) return;
    await incoming.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false } } });
    sessionRef.current = incoming;
    incomingRef.current = null;
    setCall(incoming);
    setIncomingCall(null);
    setState('active');
    setRoutePhase('connected');
    setMediaReady(true);
  }, []);

  const decline = useCallback(() => {
    hangupSession(incomingRef.current);
    incomingRef.current = null;
    setIncomingCall(null);
  }, [hangupSession]);

  const hangup = useCallback(() => {
    stopRingback();
    if (routeIdRef.current) api('/api/voice/cancel', { method: 'POST', body: { routeId: routeIdRef.current } }).catch(() => undefined);
    if (heldRouteIdRef.current) api('/api/voice/cancel', { method: 'POST', body: { routeId: heldRouteIdRef.current } }).catch(() => undefined);
    hangupSession(sessionRef.current);
    hangupSession(incomingRef.current);
    hangupSession(heldSessionRef.current);
    setEndedCall({ id: sipSessionId(sessionRef.current), identity: remoteIdentity });
    sessionRef.current = null;
    incomingRef.current = null;
    heldSessionRef.current = null;
    heldIdentityRef.current = null;
    routeIdRef.current = null;
    heldRouteIdRef.current = null;
    setCall(null);
    setIncomingCall(null);
    setHeldCall(null);
    setConference(null);
    setState(null);
    setRoutePhase('ended');
    setMediaReady(false);
    setCallStarting(false);
    setMuted(false);
  }, [hangupSession, remoteIdentity, stopRingback]);

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      setSipMuted(sessionRef.current, next);
      return next;
    });
  }, []);

  const toggleHold = useCallback(async () => {
    if (!sessionRef.current) return;
    const nextHeld = state !== 'held';
    await setSipHeld(sessionRef.current, nextHeld);
    setState(nextHeld ? 'held' : 'active');
  }, [state]);

  const startSecondCall = useCallback(async (destinationNumber, callerNumber) => {
    const current = sessionRef.current;
    if (!current || heldSessionRef.current || conference) throw new Error('Connect the first call before adding another caller.');
    await setSipHeld(current, true);
    heldSessionRef.current = current;
    heldRouteIdRef.current = routeIdRef.current;
    heldIdentityRef.current = remoteIdentity;
    setHeldCall({ id: sipSessionId(current), identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' });
    sessionRef.current = null;
    try {
      await startCall(destinationNumber, callerNumber);
    } catch (error) {
      sessionRef.current = current;
      routeIdRef.current = heldRouteIdRef.current;
      heldSessionRef.current = null;
      heldRouteIdRef.current = null;
      heldIdentityRef.current = null;
      setHeldCall(null);
      await setSipHeld(current, false);
      attachSipMedia(current);
      setCall(current);
      setState('active');
      setRoutePhase('connected');
      throw error;
    }
  }, [conference, remoteIdentity, startCall]);

  const startSecondInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    const current = sessionRef.current;
    if (!current || heldSessionRef.current || conference) throw new Error('Connect the first call before adding another caller.');
    await setSipHeld(current, true);
    heldSessionRef.current = current;
    heldRouteIdRef.current = routeIdRef.current;
    heldIdentityRef.current = remoteIdentity;
    setHeldCall({ id: sipSessionId(current), identity: remoteIdentity, routeId: routeIdRef.current, state: 'held' });
    sessionRef.current = null;
    try {
      await startInternalCall(sipUsername, extension, displayName);
    } catch (error) {
      sessionRef.current = current;
      routeIdRef.current = heldRouteIdRef.current;
      heldSessionRef.current = null;
      heldRouteIdRef.current = null;
      heldIdentityRef.current = null;
      setHeldCall(null);
      await setSipHeld(current, false);
      attachSipMedia(current);
      setCall(current);
      setState('active');
      setRoutePhase('connected');
      throw error;
    }
  }, [conference, remoteIdentity, startInternalCall]);

  const swapCalls = useCallback(async () => {
    const current = sessionRef.current;
    const held = heldSessionRef.current;
    if (!current || !held || conference) throw new Error('There is no held call to swap.');
    const heldIdentity = heldIdentityRef.current;
    await setSipHeld(current, true);
    await setSipHeld(held, false);
    attachSipMedia(held);
    heldSessionRef.current = current;
    const nextHeldRoute = routeIdRef.current;
    const nextHeldIdentity = remoteIdentity;
    routeIdRef.current = heldRouteIdRef.current;
    heldRouteIdRef.current = nextHeldRoute;
    heldIdentityRef.current = nextHeldIdentity;
    sessionRef.current = held;
    setHeldCall({ id: sipSessionId(current), identity: nextHeldIdentity, routeId: nextHeldRoute, state: 'held' });
    setCall(held);
    setRemoteIdentity(heldIdentity || remoteIdentity);
    setState('active');
    setRoutePhase('connected');
  }, [conference, remoteIdentity]);

  const mergeCalls = useCallback(async () => {
    const active = sessionRef.current;
    const held = heldSessionRef.current;
    const userAgent = credentialsRef.current?.userAgent;
    const domain = userAgent?.configuration?.uri?.host || '';
    if (!active || !held || !userAgent || !domain) throw new Error('Two connected Vocivo calls are required before merging.');
    const conferenceId = `m${Date.now().toString(36)}`;
    const target = conferenceSipUri(conferenceId, domain);
    const participants = [
      { id: sipSessionId(held), routeId: heldRouteIdRef.current, ...(heldIdentityRef.current || {}) },
      { id: sipSessionId(active), routeId: routeIdRef.current, ...remoteIdentity },
    ];
    const room = await inviteSipTarget(userAgent, target, ['X-Vocivo-Flow: conference']);
    attachSipMedia(room);
    await referSipSession(active, target);
    await referSipSession(held, target);
    hangupSession(active);
    hangupSession(held);
    sessionRef.current = room;
    heldSessionRef.current = null;
    heldRouteIdRef.current = null;
    heldIdentityRef.current = null;
    setHeldCall(null);
    setCall(room);
    setConference({ id: conferenceId, participants });
    setRemoteIdentity({ name: 'Conference', number: 'Conference', internal: true, photoUrl: '' });
    setState('active');
    setRoutePhase('connected');
    setMediaReady(true);
  }, [hangupSession, remoteIdentity]);

  const removeConferenceParticipant = useCallback(async () => {
    throw new Error('Remove the conference by hanging up. SIP conferences do not use Telnyx participant control.');
  }, []);

  const transferCall = useCallback(async (targetExtensionId) => {
    const session = sessionRef.current;
    const domain = credentialsRef.current?.userAgent?.configuration?.uri?.host || '';
    if (!session || !domain) throw new Error('There is no live SIP call to transfer.');
    const result = await api('/api/voice/directory');
    const member = (result.users || []).find((user) => user.id === targetExtensionId);
    if (!member?.sipUsername) throw new Error('That colleague is not available.');
    await referSipSession(session, sipTargetUri(member.sipUsername, domain));
    hangup();
  }, [hangup]);

  return {
    ready,
    statusLabel,
    error,
    call,
    incomingCall,
    heldCall,
    conference,
    remoteIdentity,
    state: state === 'held' ? 'held' : (routePhase === 'connected' ? 'active' : routePhase || state),
    muted,
    dialedNumber,
    endedCall,
    callStarting,
    canMerge: Boolean(heldCall && !conference),
    connected: mediaReady || state === 'held',
    incoming: Boolean(incomingCall),
    active: Boolean(call) && !incomingCall,
    notificationPermission,
    enableBrowserAlerts: async () => {
      if (typeof Notification === 'undefined') return 'unsupported';
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') await registerWebPush();
      return permission;
    },
    audioBlocked: false,
    resumeAudio: async () => undefined,
    startCall,
    startInternalCall,
    startSecondCall,
    startSecondInternalCall,
    swapCalls,
    mergeCalls,
    removeConferenceParticipant,
    transferCall,
    sendDtmf: (digit) => sessionRef.current?.info?.({ contentType: 'application/dtmf-relay', body: `Signal=${digit}\r\nDuration=250` }),
    answer,
    decline,
    hangup,
    toggleMute,
    toggleHold,
    disconnect,
  };
}
