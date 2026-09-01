import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSipVoice } from './useSipVoice';
import { useTelnyxVoice } from './useTelnyxVoice';

function voiceEdgeFromConfig(config) {
  return config?.voice_edge === 'sip' || config?.provider === 'sip' ? 'sip' : 'telnyx';
}

export function useVoice(token, enabled, identity = {}) {
  const [edge, setEdge] = useState(null);
  useEffect(() => {
    if (!enabled || !token) {
      setEdge(null);
      return undefined;
    }
    let cancelled = false;
    let retryTimer;
    const load = (attempt = 0) => {
      api('/api/voice/config').then((config) => {
        if (!cancelled) setEdge(voiceEdgeFromConfig(config));
      }).catch(() => {
        if (cancelled) return;
        if (attempt >= 8) return;
        retryTimer = window.setTimeout(() => load(attempt + 1), Math.min(8000, 600 * (attempt + 1)));
      });
    };
    load();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [enabled, token]);

  const sip = useSipVoice(token, Boolean(enabled && edge === 'sip'), identity);
  const telnyx = useTelnyxVoice(token, Boolean(enabled && edge === 'telnyx'), identity);
  if (edge === 'telnyx') return telnyx;
  return sip;
}
