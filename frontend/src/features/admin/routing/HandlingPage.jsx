import { useState } from "react";
import { BellRing, Headphones, ListFilter, Plus, Save, Trash2, Users } from "lucide-react";
import { uid } from '../configuration.js';
import { PageHeader, Field, Modal, Empty } from '../components/ui.jsx';

export function HandlingPage({ config, setConfig, extensions, onSave }) {
  const h = config.callHandling;
  const [editor, setEditor] = useState(null);
  const setHandling = (key, value) => setConfig({ ...config, callHandling: { ...h, [key]: value } });
  const defs = [
    ['ringGroups', BellRing, 'Ring groups', { name: 'New ring group', extension: '', strategy: 'Ring all', members: [], timeout: 25, fallback: 'Main voicemail' }],
    ['queues', Headphones, 'Queues', { name: 'New call queue', extension: '', strategy: 'Ring all available', members: [], maxWait: 180, fallback: 'Main voicemail' }],
    ['ivrs', ListFilter, 'Digital receptionists', { name: 'New voice menu', extension: '', greeting: 'Welcome. Please choose an option.', options: {} }],
  ];
  const openEditor = (key, item) => setEditor({ key, item: { ...item, members: [...(item.members || [])], options: { ...(item.options || {}) } } });
  const create = (key, blank) => openEditor(key, { ...blank, id: uid(key) });
  const updateEditor = (change) => setEditor((current) => ({ ...current, item: { ...current.item, ...change } }));
  const saveEditor = (event) => {
    event.preventDefault();
    const item = { ...editor.item, name: editor.item.name.trim(), extension: editor.item.extension.replace(/\D/g, '') };
    const existing = h[editor.key];
    setHandling(editor.key, existing.some((entry) => entry.id === item.id) ? existing.map((entry) => entry.id === item.id ? item : entry) : [...existing, item]);
    setEditor(null);
  };
  const routingTargets = [
    ...extensions.map((item) => ({ value: `extension:${item.id}`, label: `Extension ${item.extension} · ${item.name}` })),
    ...h.ringGroups.map((item) => ({ value: `ring_group:${item.id}`, label: `Ring group · ${item.name}` })),
    ...h.queues.map((item) => ({ value: `queue:${item.id}`, label: `Queue · ${item.name}` })),
  ];
  return <div className="page"><PageHeader eyebrow="INBOUND ROUTING" title="Call handling" subtitle="Build ring groups, queues and digital receptionists around extensions."><button className="primary" onClick={onSave}><Save /> Save call handling</button></PageHeader>
    {defs.map(([key, Icon, label, blank]) => <section className="band" key={key}><div className="section-title"><div><h2>{label}</h2><p>{key === 'ringGroups' ? 'Ring selected colleagues together.' : key === 'queues' ? 'Hold callers and connect the first available member.' : 'Route keypad choices to extensions, ring groups and queues.'}</p></div><button className="secondary" onClick={() => create(key, blank)}><Plus /> Add</button></div>{h[key].length ? <div className="object-list">{h[key].map((item) => <div key={item.id}><span className="object-icon"><Icon /></span><div><strong>{item.name}</strong><small>Extension {item.extension || 'not assigned'} · {item.strategy || 'Voice menu'}</small></div><span>{item.members?.length || Object.keys(item.options || {}).length} targets</span><div className="row-actions"><button onClick={() => openEditor(key, item)}>Edit</button><button className="danger icon-button" title={`Delete ${item.name}`} onClick={() => setHandling(key, h[key].filter((entry) => entry.id !== item.id))}><Trash2 /></button></div></div>)}</div> : <Empty icon={Icon} title={`No ${label.toLowerCase()}`} copy="Add one to expand company routing." />}</section>)}
    {editor && <Modal wide title={editor.item.name || 'Call handling route'} subtitle={editor.key === 'ivrs' ? 'Configure the prompt and each keypad destination.' : 'Choose the colleagues who should receive this call.'} onClose={() => setEditor(null)}><form className="modal-form form-grid" onSubmit={saveEditor}><Field label="Name"><input autoFocus required value={editor.item.name} onChange={(event) => updateEditor({ name: event.target.value })} /></Field><Field label="Internal extension" help="Optional private shortcut for this route."><input value={editor.item.extension} onChange={(event) => updateEditor({ extension: event.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="Optional" /></Field>
      {editor.key !== 'ivrs' && <><Field label="Distribution"><select value={editor.key === 'queues' ? 'Ring all available' : 'Ring all'} disabled><option>{editor.key === 'queues' ? 'Ring all available' : 'Ring all'}</option></select></Field><Field label={editor.key === 'queues' ? 'Maximum wait' : 'Ring timeout'}><div className="suffix-input"><input type="number" min={editor.key === 'queues' ? 15 : 10} max={editor.key === 'queues' ? 900 : 120} value={editor.key === 'queues' ? editor.item.maxWait : editor.item.timeout} onChange={(event) => updateEditor({ [editor.key === 'queues' ? 'maxWait' : 'timeout']: Number(event.target.value) })} /><span>seconds</span></div></Field><Field label="No-answer destination" wide><select value={editor.item.fallback} onChange={(event) => updateEditor({ fallback: event.target.value })}><option>Main voicemail</option><option>Main line</option></select></Field><div className="wide handling-members"><span className="handling-label">MEMBERS</span>{extensions.map((member) => <label key={member.id} className="setting-line"><div><strong>{member.name}</strong><span>Extension {member.extension} · {member.department}</span></div><input type="checkbox" checked={editor.item.members.includes(member.id)} onChange={(event) => updateEditor({ members: event.target.checked ? [...editor.item.members, member.id] : editor.item.members.filter((id) => id !== member.id) })} /></label>)}{!extensions.length && <Empty icon={Users} title="No active extensions" copy="Create users before building a group." />}</div></>}
      {editor.key === 'ivrs' && <><Field label="Welcome prompt" wide><textarea rows="4" required value={editor.item.greeting} onChange={(event) => updateEditor({ greeting: event.target.value })} /></Field><div className="wide ivr-options"><span className="handling-label">KEYPAD DESTINATIONS</span>{['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => <label key={digit}><strong>{digit}</strong><select value={editor.item.options[digit] || ''} onChange={(event) => updateEditor({ options: { ...editor.item.options, [digit]: event.target.value } })}><option value="">No action</option>{routingTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>)}</div></>}
      <footer className="wide"><button type="button" className="secondary" onClick={() => setEditor(null)}>Cancel</button><button className="primary"><Save /> Apply route</button></footer></form></Modal>}
  </div>;
}
