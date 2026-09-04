import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { registerWebPush } from '../lib/webPush';
import { reportWebVoiceError } from '../voice/telemetry';
import { describeCallRejection, sipTargetUri, sipUserFromUri } from '../voice/sipDial';
import { SessionState } from 'sip.js';
import { observeSipSession, terminateSipSession } from '../voice/sipCallLifecycle';
import { attachSipMedia, connectSipUserAgent, inviteSipTarget, sipSessionId } from '../voice/sipSession';

export function useSipVoice(token, enabled, identity = {}) {
  const sessionRef = useRef(null);
  const incomingRef = useRef(null);
  const sessionTeardownsRef = useRef(new Map());
  const routeIdRef = useRef(null);
  const credentialsRef = useRef(null);
  // Set for as long as a dial is in flight. A second click while the first
  // INVITE was still being placed replaced sessionRef with the second session
  // — leaving the first ringing on the wire with no way to hang it up, and its
  // eventual Terminated cancelling the second call's route reservation.
  const dialingRef = useRef(false);
  const dialEpochRef = useRef(0);
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
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [endedCall, setEndedCall] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  // Bumped when the SIP password needs replacing, which tears the phone down
  // and brings it back with a new one. Without it the password expired under a
  // running phone: the next re-registration was refused and calls stopped
  // arriving, with "Ready for calls" still on screen.
  const [credentialEpoch, setCredentialEpoch] = useState(0);
  const ringbackRef = useRef(null);

  useEffect(() => {
    if (!incomingCall || incomingCall.state === SessionState.Established || incomingCall.state === SessionState.Terminated) return undefined;
    const tone = new Audio('/audio/ringback.wav');
    tone.loop = true;
    tone.volume = 0.72;
    let stopped = false;
    const stop = () => { stopped = true; tone.pause(); tone.currentTime = 0; };
    const onState = (next) => {
      if (next === SessionState.Established || next === SessionState.Terminated) stop();
    };
    incomingCall.stateChange.addListener(onState);
    tone.play().then(() => { if (stopped) tone.pause(); }).catch((failure) => reportWebVoiceError('play incoming SIP ringtone', failure));
    return () => { stop(); incomingCall.stateChange.removeListener(onState); };
  }, [incomingCall]);

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
    return terminateSipSession(session).catch((failure) => {
      reportWebVoiceError('SIP hangup', failure);
      setError('Call signaling could not finish. Check your connection.');
    });
  }, [stopRingback]);

  const watchSession = useCallback((session, incoming) => {
    sessionTeardownsRef.current.get(session)?.();
    const mediaCleanup = attachSipMedia(session, 'remoteMedia', (failure) => {
      reportWebVoiceError('play remote SIP audio', failure);
      setAudioBlocked(true);
      setError('Browser audio is blocked. Allow audio playback to hear the call.');
    });
    const stateCleanup = observeSipSession(session, (next) => {
      if (next === SessionState.Terminated) {
        sessionTeardownsRef.current.get(session)?.();
        sessionTeardownsRef.current.delete(session);
      }
      if (sessionRef.current !== session && incomingRef.current !== session) return;
      if (next === SessionState.Establishing && !incoming) {
        setState('requesting');
        setRoutePhase('ringing');
        startRingback();
      }
      if (next === SessionState.Established) {
        stopRingback();
        setState('active');
        setRoutePhase('connected');
        setMediaReady(true);
      }
      if (next === SessionState.Terminated) {
        stopRingback();
        const routeId = routeIdRef.current;
        if (routeId) api('/api/voice/cancel', { method: 'POST', body: { routeId } }).catch((failure) => reportWebVoiceError('cancel terminated SIP route', failure));
        setCall(null);
        setIncomingCall(null);
        setState(null);
        setRoutePhase('ended');
        setMediaReady(false);
        sessionRef.current = null;
        incomingRef.current = null;
        routeIdRef.current = null;
        sessionTeardownsRef.current.get(session)?.();
        sessionTeardownsRef.current.delete(session);
      }
    });
    const dispose = () => { mediaCleanup(); stateCleanup(); };
    sessionTeardownsRef.current.set(session, dispose);
    if (session.state === SessionState.Terminated) {
      dispose();
      sessionTeardownsRef.current.delete(session);
    }
  }, [startRingback, stopRingback]);

  const disconnect = useCallback(async () => {
    dialEpochRef.current += 1;
    hangupSession(sessionRef.current);
    hangupSession(incomingRef.current);
    sessionTeardownsRef.current.forEach((dispose) => dispose());
    sessionTeardownsRef.current.clear();
    const connection = credentialsRef.current;
    credentialsRef.current = null;
    sessionRef.current = null;
    incomingRef.current = null;
    routeIdRef.current = null;
    setReady(false);
    setCall(null);
    setIncomingCall(null);
    setState(null);
    setRoutePhase(null);
    setMediaReady(false);
    setAudioBlocked(false);
    setMuted(false);
    setCallStarting(false);
    dialingRef.current = false;
    if (connection?.stop) {
      try { await connection.stop(); } catch (failure) { reportWebVoiceError('SIP stop', failure); }
    } else {
      try { await connection?.registerer?.unregister(); } catch (failure) { reportWebVoiceError('SIP unregister', failure); }
      try { await connection?.userAgent?.stop(); } catch (failure) { reportWebVoiceError('SIP stop', failure); }
    }
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
          if (cancelled || incomingRef.current || sessionRef.current || dialingRef.current) {
            invitation.reject({ statusCode: 486 }).catch((failure) => reportWebVoiceError('reject busy SIP call', failure));
            return;
          }
          incomingRef.current = invitation;
          setIncomingCall(invitation);
          setRemoteIdentity({
            name: invitation.remoteIdentity?.displayName || 'Incoming call',
            number: String(invitation.remoteIdentity?.uri || ''),
            internal: true,
            photoUrl: '',
          });
          watchSession(invitation, true);
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
  }, [credentialEpoch, disconnect, enabled, identity.name, token, watchSession]);

  useEffect(() => {
    if (!enabled || !token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    registerWebPush().catch((failure) => reportWebVoiceError('register browser push subscription', failure));
  }, [enabled, token]);

  const beginOutgoing = useCallback((identity, dialed) => {
    setError('');
    setAudioBlocked(false);
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
      await credentialsRef.current?.refresh?.();
      if (!userAgent.isConnected()) throw new Error('The SIP phone is reconnecting. Please try again in a moment.');
    }
    if (options.epoch !== dialEpochRef.current) return;
    const domain = credentialsRef.current?.userAgent?.configuration?.uri?.host || '';
    const target = sipTargetUri(destination, domain);
    const session = await inviteSipTarget(userAgent, target, options.headers || [], {
      onReject: (statusCode, reasonPhrase) => {
        if (options.epoch !== dialEpochRef.current) return;
        reportWebVoiceError('SIP INVITE rejected', new Error(`${statusCode} ${reasonPhrase}`));
        setError(describeCallRejection(statusCode, reasonPhrase));
      },
      onError: (failure) => {
        if (options.epoch !== dialEpochRef.current) return;
        reportWebVoiceError('SIP INVITE', failure);
        setError(failure instanceof Error && failure.message ? failure.message : 'The call could not be started.');
      },
    });
    if (options.epoch !== dialEpochRef.current) {
      await hangupSession(session);
      return;
    }
    sessionRef.current = session;
    setCall(session);
    setDialedNumber(options.dialedNumber || destination);
    setRemoteIdentity(options.identity);
    setState('requesting');
    setRoutePhase('ringing');
    setMediaReady(false);
    setCallStarting(false);
    watchSession(session, false);
    return session;
  }, [hangupSession, watchSession]);

  const cancelRoute = useCallback((routeId) => {
    if (!routeId) return Promise.resolve();
    return api('/api/voice/cancel', { method: 'POST', body: { routeId } })
      .catch((failure) => reportWebVoiceError('cancel SIP route', failure));
  }, []);

  const startCall = useCallback(async (destinationNumber, callerNumber) => {
    if (dialingRef.current || sessionRef.current || incomingRef.current) return;
    dialingRef.current = true;
    const epoch = ++dialEpochRef.current;
    const identity = { name: 'Outbound call', number: destinationNumber, internal: false, photoUrl: '' };
    beginOutgoing(identity, destinationNumber);
    const routeId = `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    routeIdRef.current = routeId;
    try {
      const reservation = await api('/api/voice/route', { method: 'POST', body: { routeId, destination: destinationNumber, callerId: callerNumber, flow: 'outbound' } });
      if (epoch !== dialEpochRef.current) { await cancelRoute(routeId); return; }
      await place(destinationNumber, {
        epoch,
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
      await cancelRoute(routeId);
      if (epoch !== dialEpochRef.current) return;
      stopRingback();
      setCallStarting(false);
      setCall(null);
      setRoutePhase(null);
      setError(callError.message || 'The call could not be started.');
      routeIdRef.current = null;
      throw callError;
    } finally {
      if (epoch === dialEpochRef.current) dialingRef.current = false;
    }
  }, [beginOutgoing, cancelRoute, place, stopRingback]);

  const startInternalCall = useCallback(async (sipUsername, extension, displayName) => {
    if (dialingRef.current || sessionRef.current || incomingRef.current) return;
    dialingRef.current = true;
    const epoch = ++dialEpochRef.current;
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
      if (epoch !== dialEpochRef.current) { await cancelRoute(routeId); return; }
      const targetUser = sipUserFromUri(reservation.destination) || String(sipUsername || '').trim();
      if (!targetUser) throw new Error('The extension route did not return a SIP destination.');
      await place(targetUser, {
        epoch,
        dialedNumber: extension,
        identity: { name: reservation.destinationName || displayName || `Extension ${extension}`, number: `Extension ${extension}`, internal: true, photoUrl: '' },
        headers: [
          `X-Vocivo-Flow: internal`,
          `X-Vocivo-Route-ID: ${routeId}`,
          `X-Vocivo-Route-Token: ${reservation.routeToken}`,
        ],
      });
    } catch (callError) {
      await cancelRoute(routeId);
      if (epoch !== dialEpochRef.current) return;
      stopRingback();
      setCallStarting(false);
      setCall(null);
      setRoutePhase(null);
      setError(callError.message || 'The extension call could not be started.');
      routeIdRef.current = null;
      throw callError;
    } finally {
      if (epoch === dialEpochRef.current) dialingRef.current = false;
    }
  }, [beginOutgoing, cancelRoute, place, stopRingback]);

  const answer = useCallback(async () => {
    const incoming = incomingRef.current;
    if (!incoming) return;
    await incoming.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    if (incomingRef.current !== incoming || incoming.state !== SessionState.Established) return;
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
    dialEpochRef.current += 1;
    stopRingback();
    cancelRoute(routeIdRef.current);
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
  }, [cancelRoute, hangupSession, remoteIdentity, stopRingback]);

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

  const resumeAudio = useCallback(async () => {
    const element = document.getElementById('remoteMedia');
    if (!element?.srcObject) return;
    try {
      await element.play();
      setAudioBlocked(false);
      setError('');
    } catch (failure) {
      setAudioBlocked(true);
      reportWebVoiceError('resume remote SIP audio', failure);
      setError('Browser audio is blocked. Allow audio playback to hear the call.');
    }
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
    audioBlocked,
    resumeAudio,
    startCall,
    startInternalCall,
    startSecondCall: unsupported,
    startSecondInternalCall: unsupported,
    swapCalls: unsupported,
    mergeCalls: unsupported,
    removeConferenceParticipant: unsupported,
    transferCall: unsupported,
    sendDtmf: (digit) => {
      // Keyed digits travel in the media (RFC 2833), which is what the switch
      // and the voice menus listen for; SIP INFO reached the proxy and nothing
      // behind it, so "press 1 for sales" from the web phone did nothing.
      const pc = sessionRef.current?.sessionDescriptionHandler?.peerConnection;
      const sender = pc?.getSenders?.().find((item) => item.track?.kind === 'audio');
      if (sender?.dtmf && typeof sender.dtmf.insertDTMF === 'function') {
        sender.dtmf.insertDTMF(String(digit), 200, 80);
        return;
      }
      sessionRef.current?.info?.({ contentType: 'application/dtmf-relay', body: `Signal=${digit}\r\nDuration=250` });
    },
    answer,
    decline,
    hangup,
    toggleMute,
    toggleHold,
    disconnect,
    // The last call's failure is not the next screen's: switching between
    // external and extension dialling used to carry "Use a complete
    // international destination" over onto the extension keypad.
    clearError: () => setError(''),
  };
}
