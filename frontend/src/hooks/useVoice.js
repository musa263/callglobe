import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSipVoice } from './useSipVoice';
import { useTelnyxVoice } from './useTelnyxVoice';

export function useVoice(token, enabled, identity = {}) {
  const [edge, setEdge] = useState('telnyx');
  useEffect(() => {
    if (!enabled || !token) {
      setEdge('telnyx');
      return undefined;
    }
    let cancelled = false;
    api('/api/voice/config').then((config) => {
      if (cancelled) return;
      setEdge(config.voice_edge === 'sip' || config.provider === 'sip' ? 'sip' : 'telnyx');
    }).catch(() => {
      if (!cancelled) setEdge('telnyx');
    });
    return () => { cancelled = true; };
  }, [enabled, token]);
  // Web origination is SIP.js. Keep a Telnyx listener so current TestFlight
  // CallKit clients can still ring the browser until the iOS SIP client ships.
  const telnyx = useTelnyxVoice(token, enabled, identity);
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
