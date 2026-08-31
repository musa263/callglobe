import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSipVoice } from './useSipVoice';
import { useTelnyxVoice } from './useTelnyxVoice';

export function useVoice(token, enabled, identity = {}) {
  const [edge, setEdge] = useState(null);
  useEffect(() => {
    if (!enabled || !token) {
      setEdge(null);
      return undefined;
    }
    let cancelled = false;
    api('/api/voice/config').then((config) => {
      if (cancelled) return;
      setEdge(config.voice_edge === 'sip' || config.provider === 'sip' ? 'sip' : 'telnyx');
    }).catch(() => {
      // Do not fall back to Telnyx on a config failure. That logs a billed WebRTC session.
      if (!cancelled) setEdge('sip');
    });
    return () => { cancelled = true; };
  }, [enabled, token]);
  const telnyx = useTelnyxVoice(token, enabled && edge === 'telnyx', identity);
  const sip = useSipVoice(token, enabled && edge === 'sip', identity);
  if (edge !== 'sip') return telnyx;

  const incomingCall = telnyx.incomingCall || sip.incomingCall;
  const telnyxLive = Boolean(telnyx.call || telnyx.incomingCall || telnyx.active || telnyx.callStarting);
  const ready = sip.ready;
  const statusLabel = !sip.ready ? sip.statusLabel : telnyx.incomingCall ? telnyx.statusLabel : 'Ready for calls';
  const error = sip.error || telnyx.error;

  if (telnyxLive) {
    return {
      ...telnyx,
      ready: ready || telnyx.ready,
      statusLabel,
      error,
      startCall: sip.startCall,
      startInternalCall: sip.startInternalCall,
    };
  }

  return {
    ...sip,
    ready,
    statusLabel,
    error,
    startInternalCall: sip.startInternalCall,
    startSecondInternalCall: sip.startSecondInternalCall,
    incomingCall,
    incoming: Boolean(incomingCall),
    answer: telnyx.incomingCall ? telnyx.answer : sip.answer,
    decline: telnyx.incomingCall ? telnyx.decline : sip.decline,
    hangup: sip.call ? sip.hangup : telnyx.hangup,
  };
}
