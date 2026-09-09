import { useEffect, useRef, useState } from 'react';
import { Phone, Play, RotateCw, Trash2, Voicemail } from 'lucide-react';
import { api, apiAudio } from '../../../shared/api';
import { describeHistory } from '../history/historyIdentity';
import { useCallingDirectory } from '../hooks/useCallingDirectory';
import { formatDuration } from '../formatting';

export default function VoicemailView({ profile, onCallAgain, voiceBusy }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); const [playing, setPlaying] = useState(null); const [busy, setBusy] = useState(''); const [remove, setRemove] = useState(null);
  const generation = useRef(0); const urlRef = useRef(''); const audioRef = useRef(null);
  const directory = useCallingDirectory(profile?.account_type === 'business' ? JSON.stringify([profile.organization_id, profile.id]) : '');
  const stop = () => {
    generation.current++; audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = ''; setPlaying(null); setBusy('');
  };
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api('/api/voice/voicemails').then(result => { if (active) setItems(result.voicemails || []); })
      .catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => { if (voiceBusy) stop(); }, [voiceBusy]);
  useEffect(() => () => { generation.current++; audioRef.current?.pause(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const play = async item => {
    if (voiceBusy) return;
    stop(); const epoch = generation.current; setBusy(item.id); setError('');
    try {
      const url = await apiAudio(`/api/voice/voicemails?audio=1&id=${encodeURIComponent(item.id)}`);
      if (epoch !== generation.current) { URL.revokeObjectURL(url); return; }
      urlRef.current = url; setPlaying({ id: item.id, url });
    } catch (failure) { if (epoch === generation.current) setError(failure.message); }
    finally { if (epoch === generation.current) setBusy(''); }
  };
  const deleteItem = async () => {
    const item = remove; if (!item || busy) return;
    stop(); setBusy(item.id); setError('');
    try {
      await api(`/api/voice/voicemails?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setItems(current => current.filter(value => value.id !== item.id)); setRemove(null);
    } catch (failure) { setError(failure.message); } finally { setBusy(''); }
  };
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">{profile?.account_type === 'business' ? 'COMPANY VOICEMAIL' : 'VOICEMAIL'}</p><h1>Voicemail</h1></div><button className="icon-button" title="Refresh voicemail" aria-label="Refresh voicemail" onClick={() => setAttempt(value => value + 1)} disabled={loading}><RotateCw /></button></header>
    {error && <p className="workspace-message" role="alert">{error}</p>}{voiceBusy && <p className="workspace-message" role="status">Playback is paused during calls.</p>}
    {loading ? <p className="workspace-message" role="status">Loading voicemail...</p> : !items.length ? <div className="empty-state"><Voicemail /><h2>No voicemail</h2></div> : <div className="communications-list">{items.map(item => {
      const peer = describeHistory({ number: item.callerNumber, name: item.callerName }, directory.users);
      return <article className="communication-row" key={item.id}><Voicemail className="row-symbol" /><div className="row-detail"><strong>{peer.label}</strong><small>{new Date(item.createdAt).toLocaleString()} · {formatDuration(item.durationSeconds)}</small>{playing?.id === item.id && <audio ref={audioRef} src={playing.url} controls autoPlay onEnded={stop} onError={() => { stop(); setError('The voicemail audio could not be played.'); }} />}</div><div className="row-actions">
        <button disabled={voiceBusy || Boolean(busy)} title={`Play voicemail from ${peer.label}`} aria-label={`Play voicemail from ${peer.label}`} onClick={() => play(item)}><Play /></button>
        <button disabled={!peer.canRedial || voiceBusy} title={`Call ${peer.label}`} aria-label={`Call ${peer.label}`} onClick={() => onCallAgain(peer.number)}><Phone /></button>
        <button disabled={Boolean(busy)} title="Delete voicemail" aria-label={`Delete voicemail from ${peer.label}`} onClick={() => setRemove(item)}><Trash2 /></button>
      </div></article>;
    })}</div>}
    {remove && <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="delete-voicemail-title"><section className="modal"><h2 id="delete-voicemail-title">Delete voicemail?</h2><p>This recording will be removed from the workspace.</p><div className="row-actions"><button disabled={Boolean(busy)} onClick={() => setRemove(null)}>Keep</button><button disabled={Boolean(busy)} onClick={deleteItem}>Delete</button></div></section></div>}
  </section>;
}
