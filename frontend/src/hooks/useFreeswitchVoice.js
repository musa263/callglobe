import { useCallback, useEffect, useRef, useState } from 'react';
import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent, Web } from 'sip.js';
import { api } from '../lib/api';
import { ProxyAwareSipTransport, registerAndWait } from '../lib/sipTransport';

const mediaOptions = { constraints: { audio: true, video: false } };

function header(session, name) {
  try { return session?.request?.getHeader?.(name) || ''; } catch { return ''; }
}

function identityFor(session, fallback = {}) {
  const uriUser = String(session?.remoteIdentity?.uri?.user || fallback.number || '');
  const callerExtension = header(session, 'X-Vocivo-Caller-Extension');
  const extension = callerExtension || (/^\d{2,5}$/.test(uriUser) ? uriUser : '');
  const name = header(session, 'X-Vocivo-Caller-Name') || session?.remoteIdentity?.displayName || fallback.name || (extension ? 'Company colleague' : 'Phone call');
  return {
    name,
    number: extension ? `Extension ${extension}` : uriUser || fallback.number || 'Unknown caller',
    internal: Boolean(extension || header(session, 'X-Vocivo-Call-Type') === 'internal'),
    photoUrl: header(session, 'X-Vocivo-Caller-Photo') || fallback.photoUrl || '',
  };
}

function publicCall(leg, state = leg?.session?.state) {
  if (!leg) return null;
  const mapped = state === SessionState.Established ? (leg.held ? 'held' : 'active')
    : state === SessionState.Terminated ? 'hangup'
      : state === SessionState.Terminating ? 'destroy'
        : leg.direction === 'inbound' ? 'ringing' : 'requesting';
  return {
    id: leg.id,
    callId: leg.id,
    state: mapped,
    direction: leg.direction,
    options: {
      direction: leg.direction,
      remoteCallerName: leg.identity.name,
      remoteCallerNumber: leg.identity.internal ? leg.identity.number.replace(/^Extension\s+/i, '') : leg.identity.number,
      destinationNumber: leg.identity.number,
      customHeaders: [
        ...(leg.identity.internal ? [{ name: 'X-Vocivo-Caller-Extension', value: leg.identity.number.replace(/^Extension\s+/i, '') }] : []),
        { name: 'X-Vocivo-Caller-Name', value: leg.identity.name },
        ...(leg.identity.photoUrl ? [{ name: 'X-Vocivo-Caller-Photo', value: leg.identity.photoUrl }] : []),
      ],
    },
  };
}

async function terminate(session) {
  if (!session) return;
  if (session.state === SessionState.Established) return session.bye();
  if (session instanceof Invitation && session.state === SessionState.Initial) return session.reject();
  if (session instanceof Inviter && [SessionState.Initial, SessionState.Establishing].includes(session.state)) return session.cancel();
}

function attachRemoteAudio(leg) {
  const stream = leg.session?.sessionDescriptionHandler?.remoteMediaStream;
  if (!stream || leg.audio) return;
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  audio.dataset.vocivoCall = leg.id;
  audio.style.display = 'none';
  audio.srcObject = stream;
  document.body.appendChild(audio);
  leg.audio = audio;
  audio.play().catch(() => undefined);
}

function removeRemoteAudio(leg) {
  if (!leg?.audio) return;
  leg.audio.pause();
  leg.audio.srcObject = null;
  leg.audio.remove();
  leg.audio = null;
}

export function useFreeswitchVoice(token, enabled, identity = {}) {
  const userAgentRef = useRef(null);
  const registererRef = useRef(null);
  const configRef = useRef(null);
  const trackSessionRef = useRef(null);
  const activeRef = useRef(null);
  const incomingRef = useRef(null);
  const heldRef = useRef(null);
  const conferenceRef = useRef(null);
  const legsRef = useRef(new Map());
  const incomingToneRef = useRef(null);
  const ringbackRef = useRef(null);
  const incomingNotificationRef = useRef(null);
  const actionBusyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting...');
  const [error, setError] = useState('');
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [heldCall, setHeldCall] = useState(null);
  const [conference, setConference] = useState(null);
  const [remoteIdentity, setRemoteIdentity] = useState({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
  const [state, setState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [endedCall, setEndedCall] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  const stopRingback = useCallback(() => {
    const tone = ringbackRef.current;
    ringbackRef.current = null;
    if (tone) { tone.pause(); tone.currentTime = 0; }
  }, []);
  const startRingback = useCallback(() => {
    stopRingback();
    const tone = new Audio('/audio/ringback.wav');
    tone.loop = true;
    tone.volume = 0.58;
    ringbackRef.current = tone;
    tone.play().catch(() => undefined);
  }, [stopRingback]);
  const stopIncomingRingtone = useCallback(() => {
    const tone = incomingToneRef.current;
    incomingToneRef.current = null;
    if (tone) { tone.pause(); tone.currentTime = 0; }
    incomingNotificationRef.current?.close?.();
    incomingNotificationRef.current = null;
    navigator.vibrate?.(0);
  }, []);
  const startIncomingRingtone = useCallback((leg) => {
    stopIncomingRingtone();
    const tone = new Audio('/audio/ringback.wav');
    tone.loop = true;
    tone.volume = 0.72;
    incomingToneRef.current = tone;
    tone.play().catch(() => undefined);
    navigator.vibrate?.([450, 250, 450, 650]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const notification = new Notification(leg.identity.name || 'Incoming Vocivo call', {
        body: leg.identity.number || 'Open Vocivo to answer',
        icon: leg.identity.photoUrl || '/vocivo-icon-192.png',
        tag: `vocivo-incoming-${leg.id}`,
        requireInteraction: true,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      incomingNotificationRef.current = notification;
    }
  }, [stopIncomingRingtone]);

  const enableBrowserAlerts = useCallback(async () => {
    const probe = new Audio('/audio/ringback.wav');
    probe.volume = 0.01;
    await probe.play().catch(() => undefined);
    probe.pause();
    if (typeof Notification === 'undefined') return 'unsupported';
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    return permission;
  }, []);

  const resetCallState = useCallback(() => {
    activeRef.current = null;
    incomingRef.current = null;
    heldRef.current = null;
    conferenceRef.current = null;
    setCall(null);
    setIncomingCall(null);
    setHeldCall(null);
    setConference(null);
    setState(null);
    setMuted(false);
    setRemoteIdentity({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
  }, []);

  const disconnect = useCallback(() => {
    stopRingback();
    stopIncomingRingtone();
    for (const leg of legsRef.current.values()) {
      removeRemoteAudio(leg);
      terminate(leg.session).catch(() => undefined);
    }
    legsRef.current.clear();
    registererRef.current?.unregister?.().catch?.(() => undefined);
    userAgentRef.current?.stop?.().catch?.(() => undefined);
    registererRef.current = null;
    userAgentRef.current = null;
    configRef.current = null;
    trackSessionRef.current = null;
    setReady(false);
    resetCallState();
  }, [resetCallState, stopIncomingRingtone, stopRingback]);

  useEffect(() => {
    if (!enabled || !token) return undefined;
    let cancelled = false;
    setStatusLabel('Connecting...');
    setError('');

    const finishLeg = (leg) => {
      removeRemoteAudio(leg);
      legsRef.current.delete(leg.id);
      if (incomingRef.current?.id === leg.id) {
        incomingRef.current = null;
        setIncomingCall(null);
        stopIncomingRingtone();
      }
      const currentConference = conferenceRef.current;
      if (currentConference?.legs.some((item) => item.id === leg.id)) {
        const legs = currentConference.legs.filter((item) => item.id !== leg.id);
        const participants = currentConference.participants.filter((item) => item.id !== leg.id);
        if (legs.length > 1) {
          conferenceRef.current = { ...currentConference, legs, participants };
          setConference({ ...currentConference, participants });
        } else {
          conferenceRef.current = null;
          setConference(null);
          const remaining = legs[0] || null;
          activeRef.current = remaining;
          setCall(publicCall(remaining));
          setRemoteIdentity(remaining?.identity || { name: 'Phone call', number: '', internal: false, photoUrl: '' });
        }
      }
      if (activeRef.current?.id !== leg.id) return;
      setEndedCall({ id: leg.id, number: leg.identity.number || 'Unknown', direction: leg.direction === 'inbound' ? 'incoming' : 'outgoing' });
      activeRef.current = null;
      setCall(null);
      setState(null);
      stopRingback();
      const held = heldRef.current;
      if (held && !conferenceRef.current) {
        heldRef.current = null;
        setHeldCall(null);
        held.held = false;
        held.session.invite({ sessionDescriptionHandlerModifiers: [] }).then(() => {
          if (cancelled) return;
          activeRef.current = held;
          setCall(publicCall(held, SessionState.Established));
          setState('active');
          setRemoteIdentity(held.identity);
        }).catch(() => terminate(held.session).catch(() => undefined));
      } else if (!conferenceRef.current) {
        setRemoteIdentity({ name: 'Phone call', number: '', internal: false, photoUrl: '' });
      }
    };

    const track = (session, direction, fallback) => {
      const leg = { id: session.id, session, direction, identity: identityFor(session, fallback), held: false, audio: null };
      legsRef.current.set(leg.id, leg);
      session.stateChange.addListener((nextState) => {
        if (cancelled) return;
        if (nextState === SessionState.Established) {
          attachRemoteAudio(leg);
          if (activeRef.current?.id === leg.id) {
            stopRingback();
            stopIncomingRingtone();
            setState(leg.held ? 'held' : 'active');
            setCall(publicCall(leg, nextState));
            setRemoteIdentity(leg.identity);
          }
        } else if (nextState === SessionState.Establishing && activeRef.current?.id === leg.id) {
          setState(direction === 'inbound' ? 'answering' : 'ringing');
          setCall(publicCall(leg, nextState));
        } else if (nextState === SessionState.Terminated) {
          finishLeg(leg);
        }
      });
      return leg;
    };
    trackSessionRef.current = track;

    api('/api/voice/config').then(async (configuration) => {
      if (cancelled) return;
      if (configuration.provider !== 'freeswitch') throw new Error('Vocivo PBX is not enabled for this account.');
      const uri = UserAgent.makeURI(`sip:${configuration.sip_user}@${configuration.sip_domain}`);
      if (!uri || !configuration.websocket_url) throw new Error('The PBX returned an invalid SIP configuration.');
      configRef.current = configuration;
      const userAgent = new UserAgent({
        uri,
        displayName: identity.name || configuration.extension || 'Vocivo user',
        authorizationUsername: configuration.sip_user,
        authorizationPassword: configuration.sip_password,
        transportConstructor: ProxyAwareSipTransport,
        transportOptions: { server: configuration.websocket_url, connectionTimeout: 12, keepAliveInterval: 25, traceSip: false },
        reconnectionAttempts: 20,
        reconnectionDelay: 3,
        noAnswerTimeout: 60,
        logBuiltinEnabled: false,
        sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] } },
        delegate: {
          onInvite: (invitation) => {
            if (cancelled) return invitation.reject().catch(() => undefined);
            const leg = track(invitation, 'inbound');
            incomingRef.current = leg;
            setIncomingCall(publicCall(leg));
            startIncomingRingtone(leg);
          },
        },
      });
      const registerer = new Registerer(userAgent, { expires: 300 });
      registerer.stateChange.addListener((nextState) => {
        if (cancelled) return;
        if (nextState === RegistererState.Registered) {
          setReady(true);
          setStatusLabel('Ready for calls');
          setError('');
        } else if (nextState === RegistererState.Unregistered) {
          setReady(false);
          setStatusLabel('Reconnecting...');
        }
      });
      userAgent.transport.stateChange.addListener((nextState) => {
        if (cancelled) return;
        if (String(nextState) === 'Disconnected') {
          setReady(false);
          setStatusLabel('Reconnecting...');
        }
      });
      userAgentRef.current = userAgent;
      registererRef.current = registerer;
      await userAgent.start();
      if (cancelled) return;
      await registerAndWait(registerer);
    }).catch((connectionError) => {
      if (cancelled) return;
      setReady(false);
      setError(connectionError.message || 'The Vocivo web phone could not connect.');
      setStatusLabel('Unable to connect');
    });

    return () => { cancelled = true; disconnect(); };
  }, [disconnect, enabled, identity.name, startIncomingRingtone, stopIncomingRingtone, stopRingback, token]);

  const placeCall = useCallback(async (destination, fallbackIdentity, extraHeaders = []) => {
    const userAgent = userAgentRef.current;
    const configuration = configRef.current;
    if (!userAgent || !configuration || !ready) throw new Error('The web phone is not ready yet.');
    const target = UserAgent.makeURI(`sip:${destination}@${configuration.sip_domain}`);
    if (!target) throw new Error('The destination is invalid.');
    const inviter = new Inviter(userAgent, target, {
      extraHeaders,
      sessionDescriptionHandlerOptions: mediaOptions,
    });
    const leg = trackSessionRef.current(inviter, 'outbound', fallbackIdentity);
    activeRef.current = leg;
    setCall(publicCall(leg));
    setRemoteIdentity(leg.identity);
    setState('ringing');
    startRingback();
    try {
      await inviter.invite();
      return leg;
    } catch (callError) {
      stopRingback();
      setError(callError.message || 'The call could not be started.');
      throw callError;
    }
  }, [ready, startRingback, stopRingback]);

  const startCall = useCallback(async (destinationNumber) => {
    setError('');
    setDialedNumber(destinationNumber);
    return placeCall(destinationNumber, { name: 'Outbound call', number: destinationNumber, internal: false, photoUrl: '' }, ['X-Vocivo-Call-Type: external']);
  }, [placeCall]);

  const startInternalCall = useCallback(async (_sipUsername, extension, displayName, photoUrl = '') => {
    setError('');
    setDialedNumber(extension);
    return placeCall(extension, { name: displayName, number: `Extension ${extension}`, internal: true, photoUrl }, ['X-Vocivo-Call-Type: internal']);
  }, [placeCall]);

  const setHeld = useCallback(async (leg, held) => {
    if (!leg || leg.session.state !== SessionState.Established) throw new Error('The call is not connected.');
    await leg.session.invite({ sessionDescriptionHandlerModifiers: held ? [Web.holdModifier] : [] });
    leg.held = held;
  }, []);

  const answer = useCallback(async () => {
    const incoming = incomingRef.current;
    if (!incoming || !(incoming.session instanceof Invitation)) return;
    setError('');
    const current = activeRef.current;
    if (current?.session.state === SessionState.Established) {
      await setHeld(current, true);
      heldRef.current = current;
      setHeldCall({ id: current.id, identity: current.identity, state: 'held' });
    }
    stopIncomingRingtone();
    activeRef.current = incoming;
    incomingRef.current = null;
    setIncomingCall(null);
    setCall(publicCall(incoming));
    setRemoteIdentity(incoming.identity);
    setState('answering');
    await incoming.session.accept({ sessionDescriptionHandlerOptions: mediaOptions });
  }, [setHeld, stopIncomingRingtone]);

  const decline = useCallback(async () => {
    const incoming = incomingRef.current;
    stopIncomingRingtone();
    incomingRef.current = null;
    setIncomingCall(null);
    if (incoming) await terminate(incoming.session).catch(() => undefined);
  }, [stopIncomingRingtone]);

  const hangup = useCallback(() => {
    stopRingback();
    stopIncomingRingtone();
    const legs = conferenceRef.current?.legs || [activeRef.current, heldRef.current].filter(Boolean);
    for (const leg of new Map(legs.map((item) => [item.id, item])).values()) terminate(leg.session).catch(() => undefined);
    resetCallState();
  }, [resetCallState, stopIncomingRingtone, stopRingback]);

  const toggleMute = useCallback(() => {
    const tracks = activeRef.current?.session?.sessionDescriptionHandler?.localMediaStream?.getAudioTracks?.() || [];
    if (!tracks.length) return;
    const next = !muted;
    tracks.forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const toggleHold = useCallback(async () => {
    const leg = activeRef.current;
    if (!leg || actionBusyRef.current) return;
    actionBusyRef.current = true;
    try {
      await setHeld(leg, !leg.held);
      setState(leg.held ? 'held' : 'active');
      setCall(publicCall(leg, SessionState.Established));
    } finally { actionBusyRef.current = false; }
  }, [setHeld]);

  const startSecondCall = useCallback(async (destinationNumber) => {
    const current = activeRef.current;
    if (!current || current.session.state !== SessionState.Established || heldRef.current || conferenceRef.current) throw new Error('Connect the first call before adding another caller.');
    await setHeld(current, true);
    heldRef.current = current;
    setHeldCall({ id: current.id, identity: current.identity, state: 'held' });
    try { await startCall(destinationNumber); }
    catch (callError) {
      heldRef.current = null;
      setHeldCall(null);
      await setHeld(current, false);
      activeRef.current = current;
      setCall(publicCall(current, SessionState.Established));
      setRemoteIdentity(current.identity);
      setState('active');
      throw callError;
    }
  }, [setHeld, startCall]);

  const startSecondInternalCall = useCallback(async (sipUsername, extension, displayName, photoUrl = '') => {
    const current = activeRef.current;
    if (!current || current.session.state !== SessionState.Established || heldRef.current || conferenceRef.current) throw new Error('Connect the first call before adding another caller.');
    await setHeld(current, true);
    heldRef.current = current;
    setHeldCall({ id: current.id, identity: current.identity, state: 'held' });
    try { await startInternalCall(sipUsername, extension, displayName, photoUrl); }
    catch (callError) {
      heldRef.current = null;
      setHeldCall(null);
      await setHeld(current, false);
      activeRef.current = current;
      setCall(publicCall(current, SessionState.Established));
      setRemoteIdentity(current.identity);
      setState('active');
      throw callError;
    }
  }, [setHeld, startInternalCall]);

  const swapCalls = useCallback(async () => {
    if (actionBusyRef.current) throw new Error('Another call action is still completing.');
    const current = activeRef.current;
    const held = heldRef.current;
    if (!current || !held || conferenceRef.current) throw new Error('There is no held call to swap.');
    actionBusyRef.current = true;
    try {
      await setHeld(current, true);
      await setHeld(held, false);
      activeRef.current = held;
      heldRef.current = current;
      setCall(publicCall(held, SessionState.Established));
      setHeldCall({ id: current.id, identity: current.identity, state: 'held' });
      setRemoteIdentity(held.identity);
      setState('active');
    } finally { actionBusyRef.current = false; }
  }, [setHeld]);

  const mergeCalls = useCallback(async () => {
    if (actionBusyRef.current) throw new Error('Another call action is still completing.');
    const current = activeRef.current;
    const held = heldRef.current;
    if (!current || !held || current.session.state !== SessionState.Established || held.session.state !== SessionState.Established) throw new Error('Two connected calls are required before merging.');
    actionBusyRef.current = true;
    try {
      await setHeld(held, false);
      const merged = {
        id: `conference-${Date.now()}`,
        legs: [held, current],
        participants: [held, current].map((leg) => ({ id: leg.id, ...leg.identity })),
      };
      conferenceRef.current = merged;
      heldRef.current = null;
      setHeldCall(null);
      setConference({ id: merged.id, participants: merged.participants });
      setState('active');
    } finally { actionBusyRef.current = false; }
  }, [setHeld]);

  const removeConferenceParticipant = useCallback(async (participantId) => {
    const current = conferenceRef.current;
    if (!current || current.participants[0]?.id === participantId) throw new Error('The primary caller cannot be removed.');
    const leg = current.legs.find((item) => item.id === participantId);
    if (!leg) throw new Error('Conference participant not found.');
    await terminate(leg.session);
  }, []);

  const transferCall = useCallback(async (targetExtensionId) => {
    const leg = activeRef.current;
    const configuration = configRef.current;
    if (!leg || leg.session.state !== SessionState.Established || !configuration) throw new Error('Connect the call before transferring it.');
    const result = await api('/api/voice/directory');
    const target = (result.users || []).find((item) => item.id === targetExtensionId);
    if (!target?.extension) throw new Error('The selected colleague is unavailable.');
    const uri = UserAgent.makeURI(`sip:${target.extension}@${configuration.sip_domain}`);
    if (!uri) throw new Error('The transfer destination is invalid.');
    await leg.session.refer(uri);
  }, []);

  const sendDtmf = useCallback((digit) => {
    const sent = activeRef.current?.session?.sessionDescriptionHandler?.sendDtmf?.(digit, { duration: 160, interToneGap: 70 });
    if (!sent) setError('The keypad tone could not be sent on this call.');
  }, []);

  const connected = state === 'active' || state === 'held';
  const active = Boolean(activeRef.current) && !incomingCall && ['ringing', 'answering', 'active', 'held'].includes(state);
  return {
    ready, statusLabel, error, call, incomingCall, heldCall, conference, remoteIdentity, state, muted, dialedNumber, endedCall,
    connected, active, notificationPermission, enableBrowserAlerts,
    startCall, startInternalCall, startSecondCall, startSecondInternalCall, swapCalls, mergeCalls, removeConferenceParticipant,
    transferCall, sendDtmf, answer, decline, hangup, toggleMute, toggleHold, disconnect,
  };
}
