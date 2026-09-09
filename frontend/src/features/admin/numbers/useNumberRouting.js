import { useEffect, useRef, useState } from 'react';

export function useNumberRouting(api, organizationId) {
  const request = useRef(api);
  request.current = api;
  const generation = useRef(0);
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() {
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await request.current('/api/admin/number-routing');
      if (current === generation.current) setData(result);
    } catch (failure) { if (current === generation.current) setError(failure.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    setData(null); void load();
    return () => { generation.current++; };
  }, [organizationId]);
  async function save(body) {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await request.current('/api/admin/number-routing', { method: 'PUT', body: { ...body, organizationId, version: data.version } });
      if (current !== generation.current) return null;
      setData(result); return result;
    } catch (failure) { if (current === generation.current) setError(failure.message); return null; }
    finally { if (current === generation.current) setBusy(false); }
  }
  return { data, error, busy, load, save };
}

export function routeLabel(item, targets) {
  if (item.source === 'verified') return 'Outbound only';
  if (!item.available) return 'Not in current calling mode';
  return targets.find(target => target.type === item.destinationType && target.id === item.destinationId)?.label
    || (item.destinationType === 'unassigned' ? 'Unassigned' : 'Destination unavailable');
}
