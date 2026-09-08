import { useEffect, useRef } from 'react';
import { api } from '../../../shared/api.js';

/** Presence is a short device lease, never an authorization or call-admission lock. */
export function useVoicePresence(scope: string, ready: boolean, busy: boolean) {
  const state = useRef({ ready, busy });
  state.current = { ready, busy };
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!scope) return;
    const instanceId = crypto.randomUUID();
    let disposed = false, inFlight = false, pending = false, sequence = 0;
    const publish = async () => {
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      const current = state.current;
      try {
        await api('/api/voice/presence', { method: 'POST', body: { instanceId, sequence: ++sequence,
          state: !navigator.onLine || !current.ready ? 'offline' : current.busy ? 'busy' : 'online' } });
      } catch { console.warn('[voice-presence] Availability update failed; lease will expire.'); }
      finally { inFlight = false; if (pending && !disposed) { pending = false; void publish(); } }
    };
    const update = () => { void publish(); };
    refresh.current = update;
    update();
    const timer = window.setInterval(update, 20_000);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { disposed = true; refresh.current = null; window.clearInterval(timer); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [scope]);
  useEffect(() => { refresh.current?.(); }, [ready, busy]);
}
