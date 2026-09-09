import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Copy, Video } from 'lucide-react';
import { api } from '../../shared/api';
const VideoRoom = lazy(() => import('./VideoRoom.jsx'));
export default function VideoLobby({ initialRoom = '', voiceBusy }) {
  const [code, setCode] = useState(initialRoom); const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  const epoch = useRef(0); const lock = useRef(false);
  useEffect(() => { if (voiceBusy) { epoch.current++; setSession(null); } }, [voiceBusy]);
  useEffect(() => () => { epoch.current++; }, []);
  const join = async roomId => {
    if (lock.current || voiceBusy) return;
    lock.current = true; const current = ++epoch.current; setBusy(true); setError('');
    try { const result = await api('/api/voice/video', { method: 'POST', body: roomId ? { roomId } : {} }); if (current === epoch.current) { setSession(result); setCode(result.roomId); } }
    catch (failure) { if (current === epoch.current) setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">VOCIVO</p><h1>Video calls</h1></div></header>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {session ? <><div className="meeting-code"><span>{session.roomId}</span><button title="Copy meeting code" aria-label="Copy meeting code" onClick={() => navigator.clipboard.writeText(session.roomId).then(() => setCopied(true)).catch(() => setError('Clipboard unavailable. Select the meeting code to copy it.'))}><Copy /></button>{copied && <small role="status">Copied</small>}</div><div className="web-video-surface"><Suspense fallback={<p role="status">Opening video...</p>}><VideoRoom session={session} onLeave={() => { epoch.current++; setSession(null); }} refreshToken={roomId => api('/api/voice/video', { method: 'POST', body: { roomId } })} /></Suspense></div></>
      : <div className="video-lobby"><Video size={36} /><h2>Meet face to face</h2>{voiceBusy && <p role="status">Finish your phone call before joining video.</p>}<button className="primary-button" disabled={busy || voiceBusy} onClick={() => join('')}>Start video meeting</button><form onSubmit={event => { event.preventDefault(); void join(code.trim()); }}><label>Meeting code<input value={code} onChange={event => setCode(event.target.value)} required maxLength={36} pattern="[0-9a-fA-F-]{36}" autoComplete="off" /></label><button className="primary-button" disabled={busy || voiceBusy || !code.trim()} type="submit">{busy ? 'Connecting...' : 'Join meeting'}</button></form></div>}
  </section>;
}
