import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Download, Pencil, Phone, Plus, RotateCw, Trash2, Video, X } from 'lucide-react';
import { api } from '../../shared/api';
import { downloadCalendar, localDateTime, utcDateTime } from './calendar';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function newDraft() { return { id: crypto.randomUUID(), title: '', kind: 'call', date: localDateTime(Date.now() + 3600_000), durationMinutes: 30, destination: '', roomId: '', notes: '' }; }
export default function MeetingsView({ onCall, onVideo, voiceBusy }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [draft, setDraft] = useState(null); const [remove, setRemove] = useState(null); const [busy, setBusy] = useState(false); const [attempt, setAttempt] = useState(0);
  const alive = useRef(true); const lock = useRef(false); const createdRoom = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true);
    api('/api/voice/meetings').then(result => { if (active) { setItems(result.meetings); setError(''); } })
      .catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const save = async event => {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const startsAt = utcDateTime(draft.date);
      if (Date.parse(startsAt) <= Date.now()) throw new Error('Choose a future date and time.');
      let roomId = draft.roomId.trim();
      if (draft.kind === 'video' && !roomId) {
        if (createdRoom.current?.id === draft.id) roomId = createdRoom.current.roomId;
        else {
          const result = await api('/api/voice/video', { method: 'POST', body: {} });
          roomId = result.roomId; createdRoom.current = { id: draft.id, roomId };
        }
        if (!alive.current) return;
        setDraft(current => ({ ...current, roomId }));
      }
      const { meeting } = await api('/api/voice/meetings', { method: draft.version ? 'PATCH' : 'POST', body: {
        id: draft.id, version: draft.version, title: draft.title, kind: draft.kind, startsAt,
        durationMinutes: Number(draft.durationMinutes), timeZone, destination: draft.destination.replace(/[ ().-]/g, ''), roomId, notes: draft.notes,
      } });
      if (alive.current) { setItems(current => [...current.filter(item => item.id !== meeting.id), meeting].sort((a, b) => a.startsAt.localeCompare(b.startsAt))); setDraft(null); }
    } catch (failure) { if (alive.current) setError(failure.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const cancel = async () => {
    if (!remove || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await api('/api/voice/meetings', { method: 'DELETE', body: { id: remove.id, version: remove.version } }); if (alive.current) { setItems(current => current.filter(item => item.id !== remove.id)); setRemove(null); } }
    catch (failure) { if (alive.current) setError(failure.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">YOUR CALENDAR</p><h1>Scheduled calls</h1></div><div className="row-actions"><button className="icon-button" title="Refresh meetings" aria-label="Refresh meetings" disabled={loading || busy} onClick={() => setAttempt(value => value + 1)}><RotateCw /></button><button className="primary-button" onClick={() => { createdRoom.current = null; setDraft(newDraft()); setError(''); }}><Plus size={18} /> Schedule</button></div></header>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {loading ? <p className="workspace-message" role="status">Loading schedule...</p> : !items.length ? <div className="empty-state"><CalendarDays /><h2>No scheduled calls</h2></div> : <div className="communications-list">{items.map(item => <article className="communication-row" key={item.id}>
      {item.kind === 'video' ? <Video className="row-symbol" /> : <Phone className="row-symbol" />}<div className="row-detail"><strong>{item.title}</strong><small>{new Date(item.startsAt).toLocaleString()} · {item.durationMinutes} min · {timeZone}</small><small>{item.kind === 'video' ? `Meeting ${item.roomId}` : item.destination}</small>{item.notes && <p>{item.notes}</p>}</div><div className="row-actions">
        <button disabled={voiceBusy} title={item.kind === 'video' ? 'Join video meeting' : 'Open scheduled call'} aria-label={item.kind === 'video' ? `Join ${item.title}` : `Call ${item.title}`} onClick={() => item.kind === 'video' ? onVideo(item.roomId) : onCall(item.destination)}>{item.kind === 'video' ? <Video /> : <Phone />}</button>
        <button title="Download calendar event" aria-label={`Download ${item.title} calendar event`} onClick={() => { try { downloadCalendar(item); } catch (failure) { setError(failure.message); } }}><Download /></button>
        <button title="Edit meeting" aria-label={`Edit ${item.title}`} onClick={() => { setError(''); setDraft({ ...item, date: localDateTime(item.startsAt) }); }}><Pencil /></button>
        <button title="Remove meeting" aria-label={`Remove ${item.title}`} onClick={() => setRemove(item)}><Trash2 /></button>
      </div></article>)}</div>}
    {draft && <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="meeting-title"><section className="modal meeting-modal"><header><h2 id="meeting-title">{draft.version ? 'Edit meeting' : 'Schedule a call'}</h2><button className="icon-button" title="Close schedule" aria-label="Close schedule" disabled={busy} onClick={() => setDraft(null)}><X /></button></header><form className="meeting-form" onSubmit={save}>
      <label>Title<input autoFocus required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Type<select value={draft.kind} disabled={busy} onChange={event => setDraft({ ...draft, kind: event.target.value })}><option value="call">Phone call</option><option value="video">Video meeting</option></select></label>
      {draft.kind === 'call' ? <label>Phone number or extension<input required maxLength={24} value={draft.destination} placeholder="+ or company extension" onChange={event => setDraft({ ...draft, destination: event.target.value })} /></label> : <label>Meeting code (optional)<input maxLength={36} value={draft.roomId} onChange={event => setDraft({ ...draft, roomId: event.target.value })} /></label>}
      <label>Date and time ({timeZone})<input type="datetime-local" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>Duration (minutes)<input type="number" min={5} max={240} step={5} required value={draft.durationMinutes} onChange={event => setDraft({ ...draft, durationMinutes: event.target.value })} /></label>
      <label>Notes<textarea maxLength={2000} rows={3} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
      {error && <p role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? 'Saving...' : 'Save meeting'}</button>
    </form></section></div>}
    {remove && <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="remove-meeting-title"><section className="modal"><h2 id="remove-meeting-title">Remove this meeting?</h2><p>Previously downloaded calendar invitations will not be updated automatically.</p><div className="row-actions"><button disabled={busy} onClick={() => setRemove(null)}>Keep</button><button disabled={busy} onClick={cancel}>Remove</button></div></section></div>}
  </section>;
}
