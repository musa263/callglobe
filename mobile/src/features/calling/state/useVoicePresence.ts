import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { api } from '../../../shared/api';
import { createRouteId } from '../engine/session';

export function useVoicePresence(scope: string, ready: boolean, busy: boolean) {
  const state = useRef({ ready, busy });
  state.current = { ready, busy };
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!scope) return;
    const instanceId = createRouteId();
    let disposed = false, inFlight = false, pending = false, sequence = 0;
    const publish = async () => {
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      const current = state.current;
      try {
        await api.post('/api/voice/presence', { instanceId, sequence: ++sequence,
          state: !current.ready ? 'offline' : current.busy ? 'busy' : AppState.currentState === 'active' ? 'online' : 'offline' });
      } catch { console.warn('[voice-presence] Availability update failed; lease will expire.'); }
      finally { inFlight = false; if (pending && !disposed) { pending = false; void publish(); } }
    };
    const update = () => { void publish(); };
    refresh.current = update;
    update();
    const timer = setInterval(() => { if (AppState.currentState === 'active' || state.current.busy) update(); }, 20_000);
    const subscription = AppState.addEventListener('change', update);
    return () => { disposed = true; refresh.current = null; clearInterval(timer); subscription.remove(); };
  }, [scope]);
  useEffect(() => { refresh.current?.(); }, [ready, busy]);
}
