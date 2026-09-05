import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSipVoice } from './useSipVoice';
import { useTelnyxVoice } from './useTelnyxVoice';

/**
 * One phone, on whichever edge the platform is using.
 *
 * On Vocivo's own SIP edge the browser registers with Kamailio and places,
 * receives and hairpins every call through it — external, extension to
 * extension, and the calls the switch hands back. Nothing here needs the
 * carrier's SDK any more, and for a while it still did: "ready" was the SIP
 * registration *and* a carrier log-in, and extension calls were placed through
 * the carrier, which dialled back at the edge from the public internet and
 * waited on a push wake-up. With the carrier log-in failing, the screen said
 * "Connecting phone..." for good and no extension could be called.
 *
 * Until /api/voice/config has said which edge this is, neither phone starts:
 * beginning a carrier log-in and then abandoning it left errors on screen that
 * belonged to a phone nobody was going to use.
 */
export function useVoice(token, enabled, identity = {}) {
  // `token` is a stable identity for the signed-in person (the profile id),
  // not a bearer token: requests authenticate with the session cookie. When
  // this really was the token, it was absent after every reload (the token is
  // deliberately kept out of storage) and the phone stayed on "Connecting…".
  const [edge, setEdge] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  useEffect(() => {
    if (!enabled || !token) {
      setEdge(null);
      return undefined;
    }
    let cancelled = false;
    let retry;
    const resolveEdge = () => {
      api('/api/voice/config').then((config) => {
        if (cancelled) return;
        setConfigurationError('');
        setEdge(config.voice_edge === 'sip' || config.provider === 'sip' ? 'sip' : 'telnyx');
      }).catch(() => {
        if (cancelled) return;
        setConfigurationError('Calling configuration is unavailable. Reconnecting...');
        retry = setTimeout(resolveEdge, 5000);
      });
    };
    setEdge(null);
    resolveEdge();
    return () => { cancelled = true; clearTimeout(retry); };
  }, [enabled, token]);
  const telnyx = useTelnyxVoice(token, enabled && edge === 'telnyx', identity);
  const sip = useSipVoice(token, enabled && edge === 'sip', identity);
  if (edge === 'sip') return sip;
  if (edge === 'telnyx') return telnyx;
  return { ...sip, ready: false, statusLabel: 'Connecting…', error: configurationError };
}
