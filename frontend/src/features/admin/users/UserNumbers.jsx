import { useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { Field } from '../components/ui.jsx';
import { routeLabel, useNumberRouting } from '../numbers/useNumberRouting.js';
import '../numbers/number-routing.css';

export function UserNumbers({ user, organizationId, api, onSaved }) {
  const { data, error, busy, load, save } = useNumberRouting(api, organizationId);
  const [inbound, setInbound] = useState([]), [outbound, setOutbound] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    if (!data) return;
    setInbound(data.numbers.filter(item => item.destinationType === 'extension' && item.destinationId === user.id).map(item => item.number));
    setOutbound(data.users.find(item => item.id === user.id)?.outboundCallerId || '');
  }, [data, user.id]);
  async function submit() {
    setNotice('');
    const reassigned = data.numbers.filter(item => inbound.includes(item.number) && item.destinationType !== 'unassigned' && !(item.destinationType === 'extension' && item.destinationId === user.id));
    const released = data.numbers.filter(item => !inbound.includes(item.number) && item.destinationType === 'extension' && item.destinationId === user.id);
    if ((reassigned.length || released.length) && !window.confirm([
      ...reassigned.map(item => `${item.number}: ${routeLabel(item, data.targets)} -> ${user.name}`),
      ...released.map(item => `${item.number}: ${user.name} -> Main line / receptionist`),
      'Apply these inbound routing changes?',
    ].join('\n'))) return;
    const result = await save({ action: 'user', extensionId: user.id, inboundNumbers: inbound, outboundCallerId: outbound, confirmReassignment: reassigned.length > 0 });
    if (result) {
      setNotice('Number assignments saved.');
      try { await onSaved?.(); }
      catch { setNotice('Number assignments saved. Refresh the Users table to see the latest values.'); }
    }
  }
  return <div className="user-numbers">
    <div className="section-title"><h3>Numbers</h3><button type="button" className="secondary" onClick={load} disabled={busy}><RefreshCw /> Reload numbers</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p role="status">{busy ? 'Loading assignments...' : 'Assignments unavailable.'}</p> : <>
      <Field label="Outbound caller ID"><select aria-label="Outbound caller ID" disabled={busy} value={outbound} onChange={event => { setOutbound(event.target.value); setNotice(''); }}>
        <option value="">Company default{data.defaultCallerId ? ` - ${data.defaultCallerId}` : ' - not configured'}</option>
        {outbound && !data.numbers.some(item => item.number === outbound && item.available) && <option value={outbound} disabled>Unavailable assigned number</option>}
        {data.numbers.filter(item => item.available).map(item => <option key={item.number} value={item.number}>{item.number}{item.label ? ` - ${item.label}` : ''}</option>)}
      </select></Field>
      <fieldset className="inbound-number-list" disabled={busy}><legend>Direct inbound numbers</legend>
        {data.numbers.filter(item => item.source !== 'verified' && (item.available || inbound.includes(item.number))).map(item => <label key={item.number}>
          <input type="checkbox" aria-label={`Assign ${item.number}`} checked={inbound.includes(item.number)} onChange={event => { setInbound(current => event.target.checked ? [...current, item.number] : current.filter(number => number !== item.number)); setNotice(''); }} />
          <span><strong>{item.number}</strong><small>{routeLabel(item, data.targets)}</small></span>
        </label>)}
        {!data.numbers.some(item => item.source !== 'verified' && item.available) && <p>No available inbound numbers.</p>}
      </fieldset>
      <div className="number-editor-actions"><button type="button" className="primary" disabled={busy} onClick={submit}><Save />{busy ? 'Saving...' : 'Save numbers'}</button></div>
    </>}
  </div>;
}
