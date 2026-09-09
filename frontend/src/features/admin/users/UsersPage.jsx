import { useMemo, useState } from 'react';
import { Download, PhoneCall, QrCode, Search, Trash2, UserRoundPlus, Users } from 'lucide-react';
import { Status, PageHeader, Empty } from '../components/ui.jsx';
import { userNumberSummary } from './user-number-summary.js';
import '../numbers/number-routing.css';

export function UsersPage({ config, items, onAdd, onEdit, onDelete, onProvision, onExport }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState([]);
  const filtered = useMemo(() => items.filter(user => [user.extension, user.name, user.department, user.email,
    userNumberSummary(config, user.id).inbound.join(' '), userNumberSummary(config, user.id).outbound].join(' ').toLowerCase().includes(query.toLowerCase())), [items, config, query]);
  return <div className="page">
    <PageHeader eyebrow="PEOPLE" title="Users" subtitle="Identity, numbers, routing, devices and permissions.">
      <button className="secondary" onClick={onExport}><Download /> Export</button>
      <button className="primary" onClick={onAdd}><UserRoundPlus /> Add user</button>
    </PageHeader>
    <div className="toolbar"><label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user, extension or number" /></label>
      <span>{selected.length ? selected.length + ' selected' : filtered.length + ' users'}</span></div>
    <div className="table-shell"><table><thead><tr>
      <th><input type="checkbox" aria-label="Select all users" checked={filtered.length > 0 && filtered.every(user => selected.includes(user.id))} onChange={event => setSelected(event.target.checked ? filtered.map(user => user.id) : [])} /></th>
      <th>User</th><th>Extension</th><th>Inbound numbers</th><th>Outbound caller ID</th><th>Access</th><th>Status</th><th />
    </tr></thead><tbody>{filtered.map(user => {
      const numbers = userNumberSummary(config, user.id);
      return <tr key={user.id}>
        <td><input type="checkbox" aria-label={'Select ' + user.name} checked={selected.includes(user.id)} onChange={event => setSelected(event.target.checked ? [...selected, user.id] : selected.filter(id => id !== user.id))} /></td>
        <td><strong>{user.name}</strong><small>{user.email || user.mobile || 'No contact detail'}</small><small>{user.department}</small></td>
        <td><button className="extension" onClick={() => onEdit(user)}>{user.extension}</button></td>
        <td className="number-assignment-cell">{numbers.inbound.length ? numbers.inbound.map(number => <span key={number}>{number}</span>) : <small>No direct number</small>}</td>
        <td className="number-assignment-cell"><span>{numbers.outbound || 'Not configured'}</span><small>{numbers.unavailable ? 'Unavailable assignment' : numbers.inherited ? 'Company default' : 'User assigned'}</small></td>
        <td><span className="role">{user.role}</span><small>{user.webLoginEnabled ? 'Web sign-in enabled' : 'Web password not set'}</small></td>
        <td><Status good={user.status === 'active'}>{user.status}</Status></td>
        <td><div className="row-actions"><button onClick={() => onEdit(user)}>Edit</button><button aria-label={'Setup QR for ' + user.name} title="Setup QR" onClick={() => onProvision(user)}><QrCode /></button>
          <button className="danger" aria-label={'Delete ' + user.name} title="Delete user" onClick={() => onDelete(user)}><Trash2 /></button></div></td>
      </tr>;
    })}</tbody></table>
      {!filtered.length && <Empty icon={Users} title="No users found" copy="No users match this search." />}
    </div>
    <div className="info-strip"><PhoneCall /><span>Calls between registered Vocivo extensions use internal SIP routing and do not consume public PSTN minutes.</span></div>
  </div>;
}
