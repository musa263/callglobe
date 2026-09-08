import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api.js';

type CallerNumber = { id: string; phone_number: string; label: string; source: string; status: string };
type Inventory = { scope: string; numbers: CallerNumber[]; busy: boolean; error: string };

/** A lightweight refresh must not remount the registered phone or wait for wallet/rates. */
export function useCallerNumbers(scope: string) {
  const [state, setState] = useState<Inventory>({ scope: '', numbers: [], busy: false, error: '' });
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const flight = useRef<{ scope: string; promise: Promise<void> } | null>(null);
  const refresh = useCallback(() => {
    if (!scope) return Promise.resolve();
    if (flight.current?.scope === scope) return flight.current.promise;
    setState(current => ({ scope, numbers: current.scope === scope ? current.numbers : [], busy: true, error: '' }));
    const request = { scope, promise: Promise.resolve() };
    request.promise = api('/api/telnyx/numbers').then(({ numbers }) => {
      if (!Array.isArray(numbers) || numbers.some(number => !number || typeof number.id !== 'string' || typeof number.phone_number !== 'string')) throw new Error('Invalid number inventory.');
      if (activeScope.current === scope && flight.current === request) setState({ scope, numbers, busy: false, error: '' });
    }).catch(() => {
      if (activeScope.current === scope && flight.current === request) setState(current => ({ ...current, scope, busy: false, error: 'Could not refresh company numbers. Please try again.' }));
    }).finally(() => { if (flight.current === request) flight.current = null; });
    flight.current = request;
    return request.promise;
  }, [scope]);
  useEffect(() => { void refresh(); return () => { flight.current = null; }; }, [refresh]);
  const current = scope && state.scope === scope ? state : { scope, numbers: [], busy: Boolean(scope), error: '' };
  return { ...current, refresh };
}
