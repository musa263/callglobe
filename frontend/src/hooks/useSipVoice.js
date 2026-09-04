import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { registerWebPush } from '../lib/webPush';
import { reportWebVoiceError } from '../voice/telemetry';
import { describeCallRejection, sipTargetUri, sipUserFromUri } from '../voice/sipDial';
import { SessionState } from 'sip.js';
import { attachSipMedia, connectSipUserAgent, inviteSipTarget, sipSessionId } from '../voice/sipSession';

export function useSipVoice(token, enabled, identity = {}) {
  const sessionRef = useRef(null);
  const incomingRef = useRef(null);
  const routeIdRef = useRef(null);
  const credentialsRef = useRef(null);
  // Set for as long as a dial is in flight. A second click while the first
  // INVITE was still being placed replaced sessionRef with the second session
  // — leaving the first ringing on the wire with no way to hang it up, and its
  // eventual Terminated cancelling the second call's route reservation.
  const dialingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting SIP…');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [remoteIdentity, setRemoteIdentity] = useState({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
  const [callStarting, setCallStarting] = useState(false);
  const [routePhase, setRoutePhase] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [endedCall, setEndedCall] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  // Bumped when the SIP password needs replacing, which tears the phone down
  // and brings it back with a new one. Without it the password expired under a
  // running phone: the next re-registration was refused and calls stopped
  // arriving, with "Ready for calls" still on screen.
  const [credentialEpoch, setCredentialEpoch] = useState(0);
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

  const disconnect = useCallback(async () => {
    hangupSession(sessionRef.current);
    hangupSession(incomingRef.current);
    const connection = credentialsRef.current;
    credentialsRef.current = null;
    if (connection?.stop) {
      try { await connection.stop(); } catch (failure) { reportWebVoiceError('SIP stop', failure); }
    } else {
      try { await connection?.registerer?.unregister(); } catch (failure) { reportWebVoiceError('SIP unregister', failure); }
      try { await connection?.userAgent?.stop(); } catch (failure) { reportWebVoiceError('SIP stop', failure); }
    }
    sessionRef.current = null;
    incomingRef.current = null;
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setState(null);
    setRoutePhase(null);
    setMediaReady(false);
    setMuted(false);
    dialingRef.current = false;
  }, [hangupSession]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    setStatusLabel('Connecting SIP…');
    let renewal;
    api('/api/voice/sip-credentials', { method: 'POST', body: { client: 'web' } }).then(async (credentials) => {
      if (cancelled) return;
      if (!credentials.wsUri) throw new Error('VOCIVO_SIP_WSS_URI is not configured.');
      // Replaced at four fifths of its life, and never sooner than five
      // minutes from now however short the answer says it is. Getting a new
      // password means building the phone again, so a call in progress is
      // waited out rather than cut off.
      const lifetime = Number(credentials.expires_in) * 1000;
      const renewIn = Math.min(Math.max(5 * 60 * 1000, (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 60 * 60 * 1000) * 0.8), 2 ** 31 - 1);
      const renew = () => {
        if (cancelled) return;
        if (sessionRef.current || incomingRef.current) {
          renewal = setTimeout(renew, 60_000);
          return;
        }
        setCredentialEpoch((epoch) => epoch + 1);
      };
      renewal = setTimeout(renew, renewIn);
      const connection = await connectSipUserAgent({
        username: credentials.username,
        password: credentials.password,
        domain: credentials.domain,
        wsUri: credentials.wsUri,
        displayName: identity.name,
        iceServers: credentials.ice_servers,
        // The phone's real state, not the state at sign-in: a dropped socket
        // used to leave "Ready for calls" on screen while calls rang nobody.
        onRegistration: (registration, reason) => {
          if (cancelled) return;
          if (registration === 'Registered') {
            setReady(true);
            setError('');
            setStatusLabel('Ready for calls');
          } else if (registration === 'Reconnecting') {
            setReady(false);
            setStatusLabel('Reconnecting…');
          } else {
            setReady(false);
            setStatusLabel('SIP unavailable');
            if (reason) setError(`The SIP phone is not registered (${reason}).`);
          }
        },
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
        await connection.stop();
        return;
      }
      credentialsRef.current = connection;
      setReady(true);
      setError('');
      setStatusLabel('Ready for calls');
    }).catch((failure) => {
      if (cancelled) return;
      setError(failure instanceof Error ? failure.message : 'The SIP phone could not register.');
      setStatusLabel('SIP unavailable');
      // A network that was not there when the tab opened left the phone dead
      // until the page was reloaded. Try again, slowly.
      renewal = setTimeout(() => { if (!cancelled) setCredentialEpoch((epoch) => epoch + 1); }, 30_000);
    });
    // A tab that comes back into view or a network that comes back gets the
    // phone registered again at once rather than on the back-off timer.
    const refresh = () => {
      if (cancelled || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      credentialsRef.current?.refresh?.().catch((failure) => reportWebVoiceError('SIP refresh', failure));
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      if (renewal) clearTimeout(renewal);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      disconnect();
    };
  }, [credentialEpoch, disconnect, enabled, identity.name, token]);

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
    // True until the INVITE is on the wire. It was only ever set to false, so
    // nothing that waits on it — a disabled dial button, a spinner — ever saw
    // a call being placed.
    setCallStarting(true);
    // A previous call may have ended muted; the new call's track starts live.
    setMuted(false);
    setCall({ id: `pending-${Date.now()}`, pending: true });
    startRingback();
  }, [startRingback]);

  const place = useCallback(async (destination, options) => {
    const userAgent = credentialsRef.current?.userAgent;
    if (!userAgent) throw new Error('The SIP phone is not registered yet.');
    if (!userAgent.isConnected()) {
      // The socket dropped while the tab was idle; get it back before dialling.
      await credentialsRef.current?.refresh?.().catch(() => undefined);
      if (!userAgent.isConnected()) throw new Error('The SIP phone is reconnecting. Please try again in a moment.');
    }
    const domain = credentialsRef.current?.userAgent?.configuration?.uri?.host || '';
    const target = sipTargetUri(destination, domain);
    const session = await inviteSipTarget(userAgent, target, options.headers || [], {
      onReject: (statusCode, reasonPhrase) => {
        reportWebVoiceError('SIP INVITE rejected', new Error(`${statusCode} ${reasonPhrase}`));
        setError(describeCallRejection(statusCode, reasonPhrase));
      },
      onError: (failure) => {
        reportWebVoiceError('SIP INVITE', failure);
        setError(failure instanceof Error && failure.message ? failure.message : 'The call could not be started.');
      },
    });
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
    if (dialingRef.current || sessionRef.current) return;
    dialingRef.current = true;
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
    } finally {
      dialingRef.current = false;
    }
  }, [beginOutgoing, place, stopRingback]);

  const startInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    if (dialingRef.current || sessionRef.current) return;
    dialingRef.current = true;
    const identity = { name: displayName || `Extension ${extension}`, number: `Extension ${extension}`, internal: true, photoUrl: '' };
    beginOutgoing(identity, extension);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    routeIdRef.current = routeId;
    try {
      const reservation = await api('/api/voice/route', {
        method: 'POST',
        body: {
          routeId,
          destination: sipUsername ? `sip:${sipUsername}@sip.telnyx.com` : '',
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
    } finally {
      dialingRef.current = false;
    }
  }, [beginOutgoing, place, stopRingback]);

  const answer = useCallback(async () => {
    const incoming = incomingRef.current;
    if (!incoming) return;
    await incoming.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    sessionRef.current = incoming;
    incomingRef.current = null;
    setCall(incoming);
    setIncomingCall(null);
    setState('active');
    setRoutePhase('connected');
    setMediaReady(true);
    // The answered call's track is live whatever the last call ended as.
    setMuted(false);
  }, []);

  const decline = useCallback(() => {
    hangupSession(incomingRef.current);
    incomingRef.current = null;
    setIncomingCall(null);
  }, [hangupSession]);

  const hangup = useCallback(() => {
    stopRingback();
    if (routeIdRef.current) api('/api/voice/cancel', { method: 'POST', body: { routeId: routeIdRef.current } }).catch(() => undefined);
    hangupSession(sessionRef.current);
    hangupSession(incomingRef.current);
    setEndedCall({ id: sipSessionId(sessionRef.current), identity: remoteIdentity });
    sessionRef.current = null;
    incomingRef.current = null;
    routeIdRef.current = null;
    setCall(null);
    setIncomingCall(null);
    setState(null);
    setRoutePhase('ended');
    setMediaReady(false);
    setCallStarting(false);
    setMuted(false);
    dialingRef.current = false;
  }, [hangupSession, remoteIdentity, stopRingback]);

  const toggleMute = useCallback(() => {
    const pc = sessionRef.current?.sessionDescriptionHandler?.peerConnection;
    pc?.getSenders().forEach((sender) => {
      if (sender.track?.kind === 'audio') sender.track.enabled = muted;
    });
    setMuted((value) => !value);
  }, [muted]);

  const toggleHold = useCallback(async () => {
    if (!sessionRef.current) return;
    if (state === 'held') await sessionRef.current.unhold?.();
    else await sessionRef.current.hold?.();
    setState((value) => (value === 'held' ? 'active' : 'held'));
  }, [state]);

  const unsupported = useCallback(async () => {
    throw new Error('Conference merge stays on Telnyx Call Control until inbound SIP cutover.');
  }, []);

  return {
    ready,
    statusLabel,
    error,
    call,
    incomingCall,
    heldCall: null,
    conference: null,
    remoteIdentity,
    state: routePhase === 'connected' ? 'active' : routePhase || state,
    muted,
    dialedNumber,
    endedCall,
    callStarting,
    canMerge: false,
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
    startSecondCall: unsupported,
    startSecondInternalCall: unsupported,
    swapCalls: unsupported,
    mergeCalls: unsupported,
    removeConferenceParticipant: unsupported,
    transferCall: unsupported,
    sendDtmf: (digit) => sessionRef.current?.info?.({ contentType: 'application/dtmf-relay', body: `Signal=${digit}\r\nDuration=250` }),
    answer,
    decline,
    hangup,
    toggleMute,
    toggleHold,
    disconnect,
  };
}
