import { useEffect, useRef, useState } from 'react';
import { initialize } from '@telnyx/video';
import { Camera, CameraOff, Mic, MicOff, PhoneOff, RefreshCw } from 'lucide-react';
import { visibleName } from '../calling/engine/callIdentity.js';
import './video.css';

function MediaTile({ stream, local = false, name }) {
  const ref = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = ref.current;
    let active = true;
    element.srcObject = stream;
    element.play().catch(() => { if (active) setBlocked(true); });
    return () => { active = false; element.pause(); element.srcObject = null; };
  }, [stream]);
  return <div className="meeting-tile"><video ref={ref} autoPlay playsInline muted={local} /><span>{name}</span>{blocked && <button onClick={() => ref.current.play().then(() => setBlocked(false)).catch(() => setBlocked(true))}>Enable audio</button>}</div>;
}

export default function VideoRoom({ session, onLeave, refreshToken }) {
  const { roomId, token, participantName: name = 'Vocivo user', participantPhotoUrl: photo = '' } = session;
  const roomRef = useRef(null); const streamRef = useRef(null); const alive = useRef(false); const switching = useRef(false);
  const [media, setMedia] = useState(null); const [remote, setRemote] = useState([]);
  const [status, setStatus] = useState('Connecting securely'); const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false); const [cameraOff, setCameraOff] = useState(false); const [facing, setFacing] = useState('user');
  const [failure, setFailure] = useState('');
  const refreshRef = useRef(refreshToken); refreshRef.current = refreshToken;
  useEffect(() => {
    let closed = false; let room; let stream; let refreshTimer; let closing;
    alive.current = true;
    const unsubscribers = [];
    const stop = () => {
      clearTimeout(refreshTimer);
      stream?.getTracks().forEach(track => track.stop());
      unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
      if (room && !closing) closing = room.disconnect().catch(() => console.warn('[video] Room disconnect failed.'));
      return closing;
    };
    const fail = () => { if (!closed) { setFailure('Video connection interrupted. Leave and rejoin to reconnect.'); setReady(false); } closed = true; alive.current = false; void stop(); };
    const remove = (participantId, key) => { if (!closed) setRemote(items => items.filter(item => item.id !== `${participantId}:${key}`)); };
    const publishRemote = (participantId, key, state) => {
      if (closed) return;
      const incoming = room.getParticipantStream(participantId, key);
      if (!incoming) return;
      let context;
      try { context = JSON.parse(state?.participants?.get(participantId)?.context || '{}'); } catch { context = {}; }
      const item = { id: `${participantId}:${key}`, name: visibleName(context.name) || 'Participant',
        stream: new MediaStream([incoming.audioTrack, incoming.videoTrack].filter(Boolean)) };
      setRemote(items => [...items.filter(current => current.id !== item.id), item]);
      setStatus('Connected');
    };
    const renew = async () => {
      if (closed || !refreshRef.current) return;
      try {
        const result = await refreshRef.current(roomId);
        if (closed) return;
        await room.updateClientToken(result.token);
        if (!closed) refreshTimer = setTimeout(renew, 50 * 60_000);
      } catch { fail(); }
    };
    async function connect() {
      try {
        room = await initialize({ roomId, clientToken: token, context: JSON.stringify({ name, photo }), enableMessages: true, logLevel: 'ERROR' });
        if (closed) { void stop(); return; }
        roomRef.current = room;
        const on = (event, fn) => unsubscribers.push(room.on(event, fn));
        on('connected', () => { if (!closed) setStatus('Waiting for participants'); });
        on('disconnected', fail);
        on('stream_published', (participantId, key) => {
          if (!closed && participantId !== room.getLocalParticipant().id) room.addSubscription(participantId, key, { audio: true, video: true }).catch(fail);
        });
        on('subscription_started', publishRemote); on('subscription_reconfigured', publishRemote);
        on('subscription_ended', remove); on('stream_unpublished', remove);
        on('participant_left', participantId => { if (!closed) setRemote(items => items.filter(item => !item.id.startsWith(`${participantId}:`))); });
        await room.connect();
        if (closed) { void stop(); return; }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (closed) { void stop(); return; }
        streamRef.current = stream; setMedia(stream);
        await room.addStream('camera', { audio: stream.getAudioTracks()[0], video: stream.getVideoTracks()[0] });
        if (closed) { void stop(); return; }
        setReady(true);
        if (refreshRef.current) refreshTimer = setTimeout(renew, 50 * 60_000);
      } catch { fail(); }
    }
    void connect();
    return () => { closed = true; alive.current = false; roomRef.current = null; streamRef.current = null; void stop(); };
  }, [roomId, token, name, photo]);

  const toggleMute = () => { const next = !muted; streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; }); setMuted(next); };
  const toggleCamera = () => { const next = !cameraOff; streamRef.current?.getVideoTracks().forEach(track => { track.enabled = !next; }); setCameraOff(next); };
  const switchCamera = async () => {
    if (switching.current || !ready) return;
    switching.current = true;
    let replacement;
    try {
      const next = facing === 'user' ? 'environment' : 'user';
      replacement = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next } } });
      const track = replacement.getVideoTracks()[0]; const current = streamRef.current; const room = roomRef.current;
      if (!alive.current || !track || !current || !room) return;
      track.enabled = !cameraOff;
      await room.updateStream('camera', { audio: current.getAudioTracks()[0], video: track });
      if (!alive.current) return;
      current.getVideoTracks().forEach(old => { current.removeTrack(old); old.stop(); });
      current.addTrack(track); replacement = null;
      setMedia(new MediaStream(current.getTracks())); setFacing(next); setFailure('');
    } catch { if (alive.current) setFailure('The other camera is unavailable.'); }
    finally { replacement?.getTracks().forEach(track => track.stop()); switching.current = false; }
  };
  return <main className="video-room">
    <div className="meeting-streams">{remote.map(item => <MediaTile key={item.id} {...item} />)}{media && <MediaTile stream={media} name={`${visibleName(name) || 'You'} (you)`} local />}</div>
    <div className="video-status" role="status"><span />{failure || status}</div>
    <div className="video-controls">
      <button disabled={!ready} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}</button>
      <button disabled={!ready} title={cameraOff ? 'Enable camera' : 'Disable camera'} aria-label={cameraOff ? 'Enable camera' : 'Disable camera'} onClick={toggleCamera}>{cameraOff ? <CameraOff /> : <Camera />}</button>
      <button disabled={!ready} title="Switch camera" aria-label="Switch camera" onClick={switchCamera}><RefreshCw /></button>
      <button className="leave" title="Leave video call" aria-label="Leave video call" onClick={onLeave}><PhoneOff /></button>
    </div>
  </main>;
}
