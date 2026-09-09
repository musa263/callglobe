import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import VideoRoom from './VideoRoom.jsx';
import { BrandHeader } from '../../shared/components/BrandHeader';
const values = new URLSearchParams(location.hash.replace(/^#/, ''));
const session = { roomId: values.get('room') || '', token: values.get('token') || '', participantName: values.get('name') || 'Vocivo user', participantPhotoUrl: values.get('photo') || '' };
function VideoEntry() {
  const [left, setLeft] = useState(false);
  return <><BrandHeader />{left ? <p className="video-ended">Video call ended</p> : <VideoRoom session={session} onLeave={() => {
    setLeft(true); window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'leave' }));
  }} />}</>;
}
ReactDOM.createRoot(document.getElementById('video-root')).render(<VideoEntry />);
