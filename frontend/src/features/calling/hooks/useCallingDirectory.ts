import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import type { CallingColleague } from '../engine/callDestination.js';

export function useCallingDirectory(scope: string) {
  const [state, setState] = useState<{ scope: string; users: CallingColleague[]; status: 'loading' | 'ready' | 'failed' }>({ scope: '', users: [], status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
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
    api('/api/voice/directory').then(({ users }) => {
      if (!Array.isArray(users) || users.some(user => !user || typeof user.id !== 'string' || typeof user.name !== 'string' || !/^\d{2,5}$/.test(user.extension))) throw new Error('Invalid directory.');
      if (!disposed) setState({ scope, users, status: 'ready' });
    }).catch(() => { if (!disposed) setState(current => ({ scope, users: current.scope === scope ? current.users.map(user => ({ ...user, presence: 'offline' })) : [], status: 'failed' })); })
      .finally(() => { inFlight = false; if (!disposed) timer = setTimeout(refresh, 20_000); });
    };
    refresh();
    window.addEventListener('online', refresh);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('online', refresh); };
  }, [scope, attempt]);
  return { users: scope && state.scope === scope ? state.users : [],
    status: !scope ? 'ready' : state.scope === scope ? state.status : 'loading', retry };
}
