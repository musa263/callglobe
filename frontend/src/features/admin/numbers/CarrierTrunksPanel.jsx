import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { Field, Modal } from '../components/ui.jsx';

import { CarrierTrunkDetails } from './CarrierTrunkDetails.jsx';
import './carrier-trunks.css';

const emptyNumber = () => ({ inboundNumber: '', callerId: '', destinationType: 'unassigned', destinationId: '' });
const newDraft = () => ({ id: crypto.randomUUID(), revision: 0, name: '', provider: '', accountReference: '', server: '', port: 5060, transport: 'UDP', publicIp: '', hostingProvider: '', authentication: 'unconfirmed', username: '', mainNumber: '', outboundProxy: '', outboundProxyPort: 5060, channelLimit: null, inboundEnabled: null, outboundEnabled: null, numbers: [], notes: '' });

export function CarrierTrunksPanel({ api, config, extensions }) {
  const [trunks, setTrunks] = useState([]), [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setLoading(true);
    api('/api/admin/carrier-trunks').then(result => { if (current) { setTrunks(result.trunks); setError(''); } })
      .catch(failure => { if (current) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api]);
  const field = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const numberField = (index, patch) => setDraft(current => ({ ...current, numbers: current.numbers.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const targets = [
    ['unassigned', 'Unassigned'], ['main', 'Main line / AI receptionist'],
    ...extensions.map(item => [`extension:${item.id}`, `${item.extension} · ${item.name}`]),
    ...(config.callHandling?.ringGroups || []).map(item => [`ring_group:${item.id}`, `Ring group · ${item.name}`]),
    ...(config.callHandling?.queues || []).map(item => [`queue:${item.id}`, `Queue · ${item.name}`]),
    ...(config.callHandling?.ivrs || []).map(item => [`ivr:${item.id}`, `Voice menu · ${item.name}`]),
  ];
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api('/api/admin/carrier-trunks', { method: 'PUT', body: draft });
      setTrunks(current => [...current.filter(item => item.id !== result.trunk.id), result.trunk]);
      setDraft(null);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="band carrier-trunks-panel">
    <div className="section-title"><div><h2>Company SIP trunks</h2><p>All carrier entries, connection details and DID destinations for {config.company.name}.</p></div><button className="primary" disabled={loading} onClick={() => { setError(''); setDraft(newDraft()); }}><Plus /> Add SIP trunk</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <p role="status">Loading carrier trunks…</p> : trunks.length ? trunks.map(item =>
      <CarrierTrunkDetails key={item.id} trunk={item} companyName={config.company.name} targets={targets} onEdit={trunk => { setError(''); setDraft(structuredClone(trunk)); }} />
    ) : <p>No carrier configurations have been added for this company.</p>}
    <p className="hint">Saving keeps these details in this company workspace. Carrier authentication and SIP edge activation are required before this trunk carries calls.</p>
    {draft && <Modal wide title={draft.revision ? `Edit ${draft.name}` : 'Add SIP trunk'} subtitle={config.company.name} onClose={() => { if (!busy) setDraft(null); }}><form className="modal-form form-grid" onSubmit={save}>
      <h3 className="wide carrier-editor-heading">General</h3>
      <Field label="Trunk name"><input required maxLength={100} value={draft.name} onChange={e => field('name', e.target.value)} /></Field>
      <Field label="Carrier provider"><input required maxLength={100} value={draft.provider} onChange={e => field('provider', e.target.value)} /></Field>
      <Field label="Account reference" help="Provider account reference; separate from SIP credentials."><input maxLength={100} value={draft.accountReference} onChange={e => field('accountReference', e.target.value)} /></Field>
      <Field label="Main trunk number" help="Choose from this trunk's DID numbers. This does not assign a destination."><select value={draft.mainNumber || ''} onChange={e => field('mainNumber', e.target.value)}><option value="">Not specified</option>{draft.numbers.filter(item => item.inboundNumber).map((item, index) => <option key={index} value={item.inboundNumber.replace(/^\+/, '')}>{item.inboundNumber}</option>)}</select></Field>
      <Field label="SIP server"><input required maxLength={253} value={draft.server} onChange={e => field('server', e.target.value)} placeholder="Carrier IP address or hostname" /></Field>
      <Field label="SIP port"><input required type="number" min={1} max={65535} value={draft.port} onChange={e => field('port', Number(e.target.value))} /></Field>
      <Field label="SIP transport"><select value={draft.transport} onChange={e => field('transport', e.target.value)}><option>UDP</option><option>TCP</option><option>TLS</option></select></Field>
      <Field label="Outbound proxy" help="Leave blank when the carrier does not specify one."><input maxLength={253} value={draft.outboundProxy || ''} onChange={e => field('outboundProxy', e.target.value)} /></Field>
      <Field label="Outbound proxy port"><input type="number" min={1} max={65535} required value={draft.outboundProxyPort ?? 5060} onChange={e => field('outboundProxyPort', Number(e.target.value))} /></Field>
      <Field label="Company public IP"><input required maxLength={15} value={draft.publicIp} onChange={e => field('publicIp', e.target.value)} /></Field>
      <Field label="Hosting provider"><input maxLength={100} value={draft.hostingProvider} onChange={e => field('hostingProvider', e.target.value)} /></Field>
      <Field label="Authentication method"><select value={draft.authentication} onChange={e => field('authentication', e.target.value)}><option value="unconfirmed">Awaiting carrier confirmation</option><option value="ip">IP authentication</option><option value="registration">SIP registration</option></select></Field>
      {draft.authentication === 'registration' && <Field label="SIP username" help="Credentials must be provisioned securely before activation."><input maxLength={100} value={draft.username} onChange={e => field('username', e.target.value)} autoComplete="off" /></Field>}
      <h3 className="wide carrier-editor-heading">Options</h3>
      <Field label="Simultaneous call limit" help="Saved carrier capacity; applied when the trunk is activated."><input type="number" min={1} max={10000} value={draft.channelLimit ?? ''} onChange={e => field('channelLimit', e.target.value === '' ? null : Number(e.target.value))} placeholder="Not specified" /></Field>
      {[['inboundEnabled', 'Inbound calls'], ['outboundEnabled', 'Outbound calls']].map(([key, label]) => <Field key={key} label={label}><select value={draft[key] == null ? '' : String(draft[key])} onChange={e => field(key, e.target.value === '' ? null : e.target.value === 'true')}><option value="">Not specified</option><option value="true">Allowed</option><option value="false">Disabled</option></select></Field>)}
      <div className="wide"><div className="section-title"><div><h3>DID numbers and destinations</h3><p>Keep destinations unassigned until you are ready to configure them.</p></div><button type="button" className="secondary" onClick={() => field('numbers', [...draft.numbers, emptyNumber()])}>Add number</button></div>
      {draft.numbers.map((number, index) => <div className="form-grid carrier-number-editor" key={index}>
        <Field label={`Inbound number ${index + 1}`}><input required value={number.inboundNumber} onChange={e => numberField(index, { inboundNumber: e.target.value })} /></Field>
        <Field label={`Outbound caller ID ${index + 1}`} help="International format, including country code."><input required value={number.callerId} onChange={e => numberField(index, { callerId: e.target.value })} /></Field>
        <Field label={`Destination ${index + 1}`}><select value={number.destinationId ? `${number.destinationType}:${number.destinationId}` : number.destinationType} onChange={e => { const [destinationType, ...id] = e.target.value.split(':'); numberField(index, { destinationType, destinationId: id.join(':') }); }}>{targets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <button type="button" className="secondary" onClick={() => setDraft(current => ({ ...current, mainNumber: current.mainNumber === number.inboundNumber.replace(/^\+/, '') ? '' : current.mainNumber, numbers: current.numbers.filter((_, i) => i !== index) }))}>Remove number {index + 1}</button>
      </div>)}</div>
      <Field wide label="Carrier notes"><input maxLength={500} value={draft.notes} onChange={e => field('notes', e.target.value)} /></Field>
      {error && <div className="error-banner wide" role="alert">{error}</div>}
      <footer className="wide"><button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="primary" disabled={busy}><Save /> {busy ? 'Saving…' : 'Save configuration'}</button></footer>
    </form></Modal>}
  </section>;
}
