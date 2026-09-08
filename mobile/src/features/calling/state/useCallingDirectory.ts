import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../../../shared/api';
import type { CallingColleague } from './dialNumber';

type DirectoryState = { scope: string; users: CallingColleague[]; status: 'loading' | 'ready' | 'failed' };

export function useCallingDirectory(enabled: boolean, organizationId?: string, userId?: string) {
  const scope = enabled ? JSON.stringify([organizationId, userId]) : '';
  const [state, setState] = useState<DirectoryState>({ scope: '', users: [], status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!scope) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    setState({ scope, users: [], status: 'loading' });
    const refresh = () => {
    if (disposed || inFlight) return;
    clearTimeout(timer);
    inFlight = true;
    api.get<{ users: CallingColleague[] }>('/api/voice/directory').then(({ users }) => {
      if (!Array.isArray(users) || users.some((user) => !user || typeof user.id !== 'string'
        || typeof user.name !== 'string' || typeof user.extension !== 'string' || !/^\d{2,5}$/.test(user.extension))) {
        throw new Error('Invalid company directory response.');
      }
      if (!disposed) setState({ scope, users, status: 'ready' });
    }).catch((error: unknown) => {
      console.warn('[dialer] Company directory unavailable', error);
      if (!disposed) setState(current => ({ scope, users: current.scope === scope ? current.users.map(user => ({ ...user, presence: 'offline' })) : [], status: 'failed' }));
    }).finally(() => { inFlight = false; if (!disposed && AppState.currentState === 'active') timer = setTimeout(refresh, 20_000); });
    };
    refresh();
    const subscription = AppState.addEventListener('change', next => { clearTimeout(timer); if (next === 'active') refresh(); });
    return () => { disposed = true; clearTimeout(timer); subscription.remove(); };
  }, [scope, attempt]);
  // A workspace change must hide the previous directory in the same render,
  // before the new effect has run or the old request has settled.
  return {
    users: scope && state.scope === scope ? state.users : [],
    status: !scope ? 'ready' as const : state.scope === scope ? state.status : 'loading' as const,
    retry,
  };
}
