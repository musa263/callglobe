import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CheckCircle2, ExternalLink, LockKeyhole, QrCode } from 'lucide-react';
import './enroll.css';

function EnrollmentPage() {
  const [opened, setOpened] = useState(false);
  const token = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || '', []);
  const appUrl = token ? `vocivo://enroll?token=${encodeURIComponent(token)}` : '';

  return <main className="enroll-page">
    <section className="enroll-shell">
      <div className="enroll-mark"><QrCode /></div>
      <p className="enroll-eyebrow">SECURE EXTENSION SETUP</p>
      <h1>Connect this iPhone to Vocivo</h1>
      <p className="enroll-copy">This time-limited setup securely adds your company extension. It expires after ten minutes and cannot reveal the SIP password.</p>
      {token ? <>
        <a className="enroll-action" href={appUrl} onClick={() => setOpened(true)}>Open Vocivo <ExternalLink /></a>
        <div className="enroll-status"><CheckCircle2 /><span>{opened ? 'Vocivo was opened. Complete setup in the app.' : 'Vocivo must already be installed on this iPhone.'}</span></div>
      </> : <div className="enroll-error">This setup link is incomplete. Ask your administrator for a new QR code.</div>}
      <div className="enroll-security"><LockKeyhole /><span>Encrypted one-time enrollment</span></div>
    </section>
  </main>;
}

ReactDOM.createRoot(document.getElementById('enroll-root')).render(<EnrollmentPage />);
