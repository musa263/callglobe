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

  const telnyxLive = Boolean(telnyx.call || telnyx.incomingCall || telnyx.active || telnyx.callStarting);
  const ready = Boolean(sip.ready && telnyx.ready);
  const statusLabel = !sip.ready ? sip.statusLabel : !telnyx.ready ? telnyx.statusLabel : 'Ready for calls';
  const error = sip.error || telnyx.error;

  if (telnyxLive) {
    return {
      ...telnyx,
      ready,
      statusLabel,
      error,
      startCall: sip.startCall,
    };
  }

  return {
    ...sip,
    ready,
    statusLabel,
    error,
    startInternalCall: telnyx.startInternalCall,
    startSecondInternalCall: telnyx.startSecondInternalCall,
    incomingCall: telnyx.incomingCall,
    incoming: telnyx.incoming,
    answer: telnyx.answer,
    decline: telnyx.decline,
  };
}
