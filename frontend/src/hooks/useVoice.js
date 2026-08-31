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
  const telnyx = useTelnyxVoice(token, enabled && edge !== 'sip', identity);
  const sip = useSipVoice(token, enabled && edge === 'sip', identity);
  return edge === 'sip' ? sip : telnyx;
}
