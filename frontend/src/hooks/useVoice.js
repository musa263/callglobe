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
  // TestFlight iOS is still Telnyx CallKit. The SIP trunk Telnyx answers OPTIONS
  // on but rejects SIP-URI INVITEs (403 D30), so extension calls and iOS ringing
  // stay on the Telnyx SDK even when the web PSTN path uses Kamailio.
  const telnyx = useTelnyxVoice(token, enabled, identity);
  const sip = useSipVoice(token, enabled && edge === 'sip', identity);
  if (edge !== 'sip') return telnyx;

  const incomingCall = telnyx.incomingCall || sip.incomingCall;
  const telnyxLive = Boolean(telnyx.call || telnyx.incomingCall || telnyx.active || telnyx.callStarting);
  const ready = Boolean(sip.ready && telnyx.ready);
  const statusLabel = !telnyx.ready ? telnyx.statusLabel : !sip.ready ? sip.statusLabel : 'Ready for calls';
  const error = telnyx.error || sip.error;

  if (telnyxLive) {
    return {
      ...telnyx,
      ready: telnyx.ready || ready,
      statusLabel: telnyx.ready ? (sip.ready ? 'Ready for calls' : sip.statusLabel) : telnyx.statusLabel,
      error,
      startCall: sip.startCall,
      startInternalCall: telnyx.startInternalCall,
    };
  }

  return {
    ...sip,
    ready,
    statusLabel,
    error,
    startInternalCall: telnyx.startInternalCall,
    startSecondInternalCall: telnyx.startSecondInternalCall,
    incomingCall,
    incoming: Boolean(incomingCall),
    answer: telnyx.incomingCall ? telnyx.answer : sip.answer,
    decline: telnyx.incomingCall ? telnyx.decline : sip.decline,
    hangup: sip.call ? sip.hangup : telnyx.hangup,
  };
}
