import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { initialize } from '@telnyx/video';
import { Camera, CameraOff, Mic, MicOff, PhoneOff, RefreshCw } from 'lucide-react';
import './video.css';

const values = new URLSearchParams(location.hash.replace(/^#/, ''));

function VideoRoom() {
  const localRef = useRef(null); const remoteRef = useRef(null); const roomRef = useRef(null); const streamRef = useRef(null);
  const [status, setStatus] = useState('Connecting securely'); const [muted, setMuted] = useState(false); const [cameraOff, setCameraOff] = useState(false); const [facing, setFacing] = useState('user');
  const roomId = values.get('room') || ''; const token = values.get('token') || ''; const name = values.get('name') || 'Vocivo user'; const photo = values.get('photo') || '';

  useEffect(() => {
    let closed = false;
    async function connect() {
      try {
        const room = await initialize({ roomId, clientToken: token, context: JSON.stringify({ name, photo }), enableMessages: true });
        roomRef.current = room;
        room.on('connected', () => setStatus('Waiting for another participant'));
        room.on('participant_joined', () => setStatus('Participant joined'));
        room.on('stream_published', async (participantId, key) => { if (participantId !== room.getLocalParticipant().id) await room.addSubscription(participantId, key, { audio: true, video: true }); });
        room.on('subscription_started', (participantId, key) => { const remote = room.getParticipantStream(participantId, key); if (remoteRef.current && remote) remoteRef.current.srcObject = new MediaStream([remote.audioTrack, remote.videoTrack].filter(Boolean)); setStatus('Video call connected'); });
        await room.connect();
        const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (closed) return media.getTracks().forEach((track) => track.stop());
        streamRef.current = media; if (localRef.current) localRef.current.srcObject = media;
        await room.addStream('camera', { audio: media.getAudioTracks()[0], video: media.getVideoTracks()[0] });
      } catch (error) { setStatus(error?.message || 'Video connection failed'); }
    }
    connect();
    return () => { closed = true; streamRef.current?.getTracks().forEach((track) => track.stop()); roomRef.current?.disconnect().catch(() => undefined); };
  }, []);

  const toggleMute = () => { const next = !muted; streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); };
  const toggleCamera = () => { const next = !cameraOff; streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; }); setCameraOff(next); };
  const switchCamera = async () => { const next = facing === 'user' ? 'environment' : 'user'; const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: next } } }).catch(() => null); const track = stream?.getVideoTracks()[0]; if (!track) return; const old = streamRef.current?.getVideoTracks()[0]; old?.stop(); streamRef.current?.removeTrack(old); streamRef.current?.addTrack(track); if (localRef.current) localRef.current.srcObject = streamRef.current; await roomRef.current?.updateStream('camera', { audio: streamRef.current?.getAudioTracks()[0], video: track }); setFacing(next); };
  const leave = async () => { await roomRef.current?.disconnect(); streamRef.current?.getTracks().forEach((track) => track.stop()); window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'leave' })); };

  return <main className="video-room"><video ref={remoteRef} className="remote-video" autoPlay playsInline /><video ref={localRef} className={`local-video ${cameraOff ? 'hidden' : ''}`} autoPlay playsInline muted />{cameraOff && <div className="local-avatar">{photo ? <img src={photo} alt={name} /> : <span>{name.charAt(0).toUpperCase()}</span>}</div>}<div className="video-status"><span />{status}</div><div className="video-controls"><button className={muted ? 'active' : ''} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}</button><button className={cameraOff ? 'active' : ''} onClick={toggleCamera}>{cameraOff ? <CameraOff /> : <Camera />}</button><button onClick={switchCamera}><RefreshCw /></button><button className="leave" onClick={leave}><PhoneOff /></button></div></main>;
}

ReactDOM.createRoot(document.getElementById('video-root')).render(<VideoRoom />);
