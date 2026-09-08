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
    setState({ scope, users: [], status: 'loading' });
    api('/api/voice/directory').then(({ users }) => {
      if (!Array.isArray(users) || users.some(user => !user || typeof user.id !== 'string' || typeof user.name !== 'string' || !/^\d{2,5}$/.test(user.extension))) throw new Error('Invalid directory.');
      if (!disposed) setState({ scope, users, status: 'ready' });
    }).catch(() => { if (!disposed) setState({ scope, users: [], status: 'failed' }); });
    return () => { disposed = true; };
  }, [scope, attempt]);
  return { users: scope && state.scope === scope ? state.users : [],
    status: !scope ? 'ready' : state.scope === scope ? state.status : 'loading', retry };
}
