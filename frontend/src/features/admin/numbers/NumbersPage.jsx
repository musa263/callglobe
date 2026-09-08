import { useState } from 'react';
import { PhoneIncoming, RefreshCw, Trash2 } from 'lucide-react';
import { Empty, Modal, PageHeader } from '../components/ui.jsx';
import { CarrierTrunksPanel } from './CarrierTrunksPanel.jsx';

export function NumbersPage({ data, config, extensions, onRefresh, api }) {
  const [removing, setRemoving] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ownCarrier = data?.callingMode === 'carrier' || config.company.callingMode === 'carrier';
  const legacyNumbers = ownCarrier ? data?.legacyNumbers || [] : data?.numbers || [];
  async function removeNumber() {
    setBusy(true); setError('');
    try {
      await api('/api/admin/carrier-trunks', { method: 'PATCH', body: {
        action: 'remove-company-number', phoneNumber: removing.phoneNumber,
      } });
      setRemoving(null);
      await onRefresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="page">
    <PageHeader eyebrow="NUMBER MANAGEMENT" title="Phone numbers" subtitle="Bring your carrier's SIP trunk and numbers, then choose a destination for each line.">
      <button className="secondary" onClick={onRefresh}><RefreshCw /> Refresh</button>
    </PageHeader>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <CarrierTrunksPanel api={api} config={config} extensions={extensions} onInventoryChange={onRefresh} />
    {legacyNumbers.length > 0 && <section className="band">
      <div className="section-title"><div><h2>{ownCarrier ? 'Previous company numbers' : 'Existing company numbers'}</h2>
        <p>{ownCarrier ? 'These numbers are excluded from calling through your own carrier.' : 'Numbers already assigned to this workspace.'}</p></div></div>
      <div className="table-shell"><table><thead><tr><th>Number</th><th>Company</th><th>Calling route</th><th /></tr></thead>
        <tbody>{legacyNumbers.map(item => <tr key={item.id}><td><strong>{item.phoneNumber}</strong></td><td>{config.company.name}</td>
          <td>{ownCarrier ? 'Not selected' : 'Existing managed service'}</td><td><button className="secondary" disabled={busy}
            onClick={() => { setError(''); setRemoving(item); }} aria-label={`Remove ${item.phoneNumber} from company`}><Trash2 /> Remove from company</button></td></tr>)}</tbody>
      </table></div>
    </section>}
    {!legacyNumbers.length && !data?.numbers?.length && <Empty icon={PhoneIncoming} title="Add your existing carrier numbers" copy="Enter your provider's SIP details and DID numbers above. Each number can have its own destination." />}
    {removing && <Modal title="Remove company number" onClose={() => { if (!busy) setRemoving(null); }}>
      <p>Remove <strong>{removing.phoneNumber}</strong> from this company's caller IDs and inbound routing?</p>
      <p>The carrier account keeps the number. This does not purchase or release a carrier number.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <footer><button className="secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
        <button className="danger" disabled={busy} onClick={removeNumber}>{busy ? 'Removing…' : 'Remove number'}</button></footer>
    </Modal>}
  </div>;
}
