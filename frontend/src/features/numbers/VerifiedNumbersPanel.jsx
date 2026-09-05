import { useState } from "react";
import { Check, PhoneCall, Plus, Trash2 } from "lucide-react";

export function VerifiedNumbersPanel({ numbers, pending, busy, error, onRequest, onVerify, onRemove, onCancel }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [method, setMethod] = useState('sms');
  const [code, setCode] = useState('');

  return (
    <div className="settings-section verified-section">
      <div className="section-heading"><div><h2>Verified caller IDs</h2><p>Use a number you already own as the caller ID for outgoing calls.</p></div></div>
      {numbers.map((number) => <div className="setting-row" key={number.id}><span className="setting-icon good"><Check /></span><div><strong>{number.phone_number}</strong><small>Verified for outgoing caller ID</small></div><button className="icon-danger" onClick={() => onRemove(number.phone_number)} title="Remove verified number"><Trash2 size={16} /></button></div>)}

      {!pending && <form className="verification-form" onSubmit={(event) => { event.preventDefault(); onRequest(phoneNumber, method); }}>
        <label>Phone number<input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+966 50 123 4567" inputMode="tel" required /></label>
        <div className="verification-method" aria-label="Verification method"><button type="button" className={method === 'sms' ? 'active' : ''} onClick={() => setMethod('sms')}>Text message</button><button type="button" className={method === 'call' ? 'active' : ''} onClick={() => setMethod('call')}>Voice call</button></div>
        <button className="add-number-button" disabled={busy}><Plus size={17} /> {busy ? 'Sending code...' : 'Add and verify'}</button>
      </form>}

      {pending && <form className="verification-form code-form" onSubmit={(event) => { event.preventDefault(); onVerify(pending.phone_number, code); }}>
        <div className="verification-copy"><strong>Enter the code sent to {pending.phone_number}</strong><small>Vocivo sent it by {pending.verification_method === 'call' ? 'voice call' : 'text message'}.</small>{pending.verification_method === 'sms' && <button type="button" className="voice-fallback" onClick={() => onRequest(pending.phone_number, 'call')} disabled={busy}><PhoneCall size={14} /> No text? Send by voice call</button>}</div>
        <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="123456" inputMode="numeric" autoFocus required /></label>
        <div className="verification-actions"><button type="button" className="secondary-small" onClick={onCancel}>Cancel</button><button className="add-number-button" disabled={busy}>{busy ? 'Checking...' : 'Confirm number'}</button></div>
      </form>}
      {error && <div className="inline-error verification-error">{error}</div>}
    </div>
  );
}
