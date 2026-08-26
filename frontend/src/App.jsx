import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, AlertTriangle, CreditCard, Delete, Check, ChevronDown, CircleDollarSign,
  Clock3, ContactRound, Globe2, Headphones, History, LogOut, Mic, MicOff, Pause,
  Phone, PhoneCall, PhoneIncoming, PhoneOff, Plus, Search, Settings, ShieldCheck,
  Trash2, Volume2, WalletCards, Wifi, WifiOff, X,
} from 'lucide-react';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { api, clearSession, getStoredSession, storeSession } from './lib/api';
import { buildDialingDirectory } from './lib/countries';
import { useTelnyxVoice } from './hooks/useTelnyxVoice';
import AdminConsole from './admin/AdminConsole';

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', ''],
];
const SAMPLE_RATES = [
  { id: 'us', country_code: 'US', country_name: 'United States', dial_code: '+1', rate_per_min: 0.02 },
  { id: 'gb', country_code: 'GB', country_name: 'United Kingdom', dial_code: '+44', rate_per_min: 0.025 },
  { id: 'sa', country_code: 'SA', country_name: 'Saudi Arabia', dial_code: '+966', rate_per_min: 0.04 },
  { id: 'ae', country_code: 'AE', country_name: 'United Arab Emirates', dial_code: '+971', rate_per_min: 0.03 },
  { id: 'pk', country_code: 'PK', country_name: 'Pakistan', dial_code: '+92', rate_per_min: 0.04 },
  { id: 'in', country_code: 'IN', country_name: 'India', dial_code: '+91', rate_per_min: 0.015 },
];
const SAMPLE_NUMBER = { id: 'preview', phone_number: '+18447161777', label: 'Vocivo', country_code: 'US', receives_calls: true, source: 'owned' };
const SAMPLE_DIRECTORY = buildDialingDirectory(SAMPLE_RATES);

function formatPhone(value) {
  if (!value) return '';
  const clean = value.replace(/[^+\d*#]/g, '');
  if (!clean.startsWith('+')) return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
  return `+${clean.slice(1).replace(/(\d{3})(?=\d)/g, '$1 ')}`;
}

function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function Login({ onLogin, onPreview }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
      storeSession(result);
      onLogin(result);
    } catch (loginError) { setError(loginError.message); } finally { setLoading(false); }
  }
  return (
    <main className="login-shell">
      <section className="login-brand" aria-label="Vocivo">
        <div className="brand-lockup"><span className="brand-mark"><Globe2 size={25} /></span><span>Vocivo</span></div>
        <div className="login-message">
          <p className="eyebrow">YOUR PRIVATE CALLING DESK</p>
          <h1>International calls, on your own line.</h1>
          <p>Place and receive calls from your browser using numbers assigned through Vocivo.</p>
        </div>
        <div className="trust-row">
          <span><ShieldCheck size={17} /> Secure connection</span>
          <span><PhoneIncoming size={17} /> Incoming calls</span>
          <span><ContactRound size={17} /> Caller ID control</span>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div><p className="eyebrow">WELCOME BACK</p><h2>Sign in to Vocivo</h2><p className="muted">Use your Vocivo platform or company account.</p></div>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Your password" minLength={8} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Signing in...' : <><PhoneCall size={18} /> Sign in</>}</button>
          <button className="secondary-button" type="button" onClick={onPreview}>Preview interface</button>
        </form>
      </section>
    </main>
  );
}

function CallerIdMenu({ numbers, selected, onSelect, open, onToggle }) {
  return (
    <div className="caller-picker">
      <button className="caller-trigger" onClick={onToggle} aria-expanded={open}>
        <span className="line-icon"><Phone size={15} /></span>
        <span><small>CALLING FROM</small><strong>{selected?.label || 'Choose a number'}</strong></span>
        <span className="caller-number">{selected?.phone_number || 'No number'}</span><ChevronDown size={16} />
      </button>
      {open && <div className="caller-menu">{numbers.map((number) => (
        <button key={number.id} onClick={() => onSelect(number)}><span><strong>{number.label}</strong><small>{number.phone_number}</small></span>{selected?.id === number.id && <Check size={17} />}</button>
      ))}</div>}
    </div>
  );
}

function IncomingCall({ call, onAnswer, onDecline }) {
  const headers = call?.options?.customHeaders || call?.options?.dialogParams?.customHeaders || [];
  const header = (key) => { const item = headers.find((value) => String(value?.name || value?.header_name || '').toLowerCase() === key.toLowerCase()); return item?.value || item?.header_value; };
  const remoteName = call?.options?.remoteCallerName || '';
  const displayMatch = String(remoteName).trim().match(/^(.+?)\s*-\s*Ext(?:ension)?\s+(\d{2,5})$/i);
  const extension = header('X-Vocivo-Caller-Extension') || displayMatch?.[2];
  const remoteNumber = call?.options?.remoteCallerNumber || call?.options?.callerNumber || 'Unknown caller';
  const number = extension ? `Extension ${extension}` : String(remoteNumber).startsWith('sip:') ? 'Internal call' : remoteNumber;
  const name = header('X-Vocivo-Caller-Name') || displayMatch?.[1] || remoteName || 'Incoming call';
  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-modal incoming-modal">
        <span className="ring-icon"><PhoneIncoming size={29} /></span><p className="eyebrow">INCOMING CALL</p><h2>{name}</h2><p className="call-number">{formatPhone(number)}</p>
        <div className="incoming-actions"><button className="round-action decline" onClick={onDecline} title="Decline call"><PhoneOff /></button><button className="round-action answer" onClick={onAnswer} title="Answer call"><Phone /></button></div>
        <div className="action-labels"><span>Decline</span><span>Answer</span></div>
      </div>
    </div>
  );
}

function ActiveCall({ voice, number, elapsed }) {
  const remote = voice.remoteIdentity?.number || number;
  const name = voice.remoteIdentity?.name || 'Phone call';
  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-modal active-modal">
        <div className="live-pill"><span /> {voice.state === 'held' ? 'ON HOLD' : 'LIVE CALL'}</div>
        <div className="call-avatar">{name.charAt(0).toUpperCase()}</div><h2>{name}</h2><p className="call-number">{voice.remoteIdentity?.internal ? remote : formatPhone(remote)}</p><strong className="call-timer">{formatDuration(elapsed)}</strong>
        <div className="call-controls">
          <button className={voice.muted ? 'control active' : 'control'} onClick={voice.toggleMute} title={voice.muted ? 'Unmute' : 'Mute'}>{voice.muted ? <MicOff /> : <Mic />}<span>{voice.muted ? 'Unmute' : 'Mute'}</span></button>
          <button className={voice.state === 'held' ? 'control active' : 'control'} onClick={voice.toggleHold} title="Hold call"><Pause /><span>Hold</span></button>
          <button className="control" disabled title="Audio output"><Volume2 /><span>Audio</span></button>
        </div>
        <button className="hangup-button" onClick={voice.hangup}><PhoneOff size={24} /> End call</button>
      </div>
    </div>
  );
}

function Dialer({ balance, rates, numbers, selectedNumber, setSelectedNumber, voice, preview, onPreviewCall, accountType }) {
  const [dialMode, setDialMode] = useState('external');
  const [number, setNumber] = useState('');
  const [country, setCountry] = useState(rates[0]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [callerOpen, setCallerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [callError, setCallError] = useState('');
  const businessAccount = accountType === 'business';
  useEffect(() => { if (!country && rates.length) setCountry(rates[0]); }, [country, rates]);
  const filteredRates = rates.filter((rate) => `${rate.country_name} ${rate.dial_code}`.toLowerCase().includes(search.toLowerCase()));
  const fullNumber = number.startsWith('+') ? number : `${country?.dial_code || ''}${number}`;
  const minutes = country?.rate_per_min ? Math.floor(balance / country.rate_per_min) : null;
  const destinationCountry = parsePhoneNumberFromString(fullNumber)?.country || country?.country_code;
  const callerCountry = selectedNumber?.country_code || parsePhoneNumberFromString(selectedNumber?.phone_number || '')?.country;
  const routeRisk = selectedNumber?.source === 'verified' && callerCountry === destinationCountry && !['US', 'CA'].includes(destinationCountry || '');
  const ownedFallback = numbers.find((item) => item.source === 'owned' && item.phone_number !== selectedNumber?.phone_number);
  function pressKey(value, secondary) {
    if (value === '0' && secondary === '+' && number === '') setNumber('+'); else setNumber((current) => `${current}${value}`.slice(0, 22));
  }
  async function call() {
    if (!number) return;
    if (preview) return onPreviewCall();
    if (dialMode === 'extension') {
      setCallError('');
      try {
        const result = await api(`/api/voice/directory?extension=${encodeURIComponent(number)}`);
        const colleague = result.users?.[0];
        if (!colleague?.sipUsername) throw new Error(`Extension ${number} is not available in your organization.`);
        await voice.startInternalCall(colleague.sipUsername, colleague.extension, colleague.name);
      } catch (extensionError) { setCallError(extensionError.message || 'The extension call could not be started.'); }
      return;
    }
    if (routeRisk) {
      setCallError(`Local carriers may not ring when ${selectedNumber.phone_number} is used for this same-country call. Switch to your Vocivo number.`);
      return;
    }
    setCallError('');
    await voice.startCall(fullNumber, selectedNumber?.phone_number);
  }
  return (
    <section className="dialer-workspace">
      <header className="workspace-header"><div><p className="eyebrow">WEB PHONE</p><h1>Make a call</h1></div><div className={`status-badge ${voice.ready ? 'online' : ''}`}>{voice.ready ? <Wifi size={15} /> : <WifiOff size={15} />}{preview ? 'Preview mode' : voice.ready ? 'Ready for calls' : voice.statusLabel}</div></header>
      <div className="dialer-layout">
        <div className="dialer-panel">
          {businessAccount && <div className="dial-mode" role="group" aria-label="Call type"><button className={dialMode === 'external' ? 'active' : ''} onClick={() => { setDialMode('external'); setNumber(''); setCallError(''); }}><Globe2 size={16} /> External</button><button className={dialMode === 'extension' ? 'active' : ''} onClick={() => { setDialMode('extension'); setNumber(''); setCallError(''); }}><ContactRound size={16} /> Extension</button></div>}
          {dialMode === 'external' && <CallerIdMenu numbers={numbers} selected={selectedNumber} onSelect={(value) => { setSelectedNumber(value); setCallerOpen(false); }} open={callerOpen} onToggle={() => setCallerOpen((value) => !value)} />}
          <div className="destination-field">
            {dialMode === 'external' ? <button className="country-trigger" onClick={() => setCountryOpen((value) => !value)} aria-label="Choose destination country"><span>{country?.country_code || '--'}</span><ChevronDown size={15} /></button> : <span className="extension-prefix">EXT</span>}
            <input value={number} onChange={(event) => setNumber(event.target.value.replace(dialMode === 'extension' ? /\D/g : /[^+\d*#]/g, '').slice(0, dialMode === 'extension' ? 5 : 22))} placeholder={dialMode === 'extension' ? 'Enter company extension' : 'Enter phone number'} inputMode="tel" aria-label={dialMode === 'extension' ? 'Company extension' : 'Phone number'} />
            <button className="erase-button" onClick={() => setNumber((value) => value.slice(0, -1))} disabled={!number} title="Delete digit"><Delete size={19} /></button>
            {dialMode === 'external' && countryOpen && <div className="country-menu"><div className="country-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search country" autoFocus /></div><div className="country-list">{filteredRates.map((rate) => (
              <button key={rate.id} onClick={() => { setCountry(rate); setCountryOpen(false); setSearch(''); }}><span className="country-code">{rate.country_code}</span><span><strong>{rate.country_name}</strong><small>{rate.dial_code}</small></span><em>{rate.rate_per_min ? `$${rate.rate_per_min.toFixed(3)}/min` : 'Available'}</em></button>
            ))}</div></div>}
          </div>
          {dialMode === 'external' ? <><div className="rate-strip"><span><small>DESTINATION</small><strong>{country?.country_name || 'Select country'}</strong></span><span><small>COUNTRY CODE</small><strong>{country?.dial_code || '-'}</strong></span><span><small>ESTIMATED TIME</small><strong>{minutes ? `${minutes.toLocaleString()} min` : 'See live rate'}</strong></span></div>{routeRisk && <div className="route-warning"><AlertTriangle size={18} /><div><strong>This caller ID may not ring locally</strong><small>Some countries filter verified same-country caller IDs arriving through international routes. An owned international number is usually more compatible.</small></div>{ownedFallback && <button onClick={() => { setSelectedNumber(ownedFallback); setCallError(''); }}>Use {formatPhone(ownedFallback.phone_number)}</button>}</div>}</> : <div className="rate-strip extension-strip"><span><small>ROUTE</small><strong>Private company network</strong></span><span><small>COST</small><strong>Free internal call</strong></span><span><small>PHONE NUMBER</small><strong>Not required</strong></span></div>}
          <div className="keypad" aria-label="Phone keypad">{KEYS.map(([key, letters]) => <button key={key} onClick={() => pressKey(key, letters)}><strong>{key}</strong><small>{letters}</small></button>)}</div>
          {(callError || voice.error) && <div className="inline-error">{callError || voice.error}</div>}
          <button className="call-button" onClick={call} disabled={!number || (dialMode === 'extension' && !/^\d{2,5}$/.test(number)) || (!preview && !voice.ready)}><Phone size={22} /> {voice.ready || preview ? (dialMode === 'extension' ? 'Call extension' : 'Call now') : 'Connecting phone...'}</button>
        </div>
      </div>
    </section>
  );
}

function WalletView({ balance, preview }) {
  return <section className="content-view wallet-view">
    <header className="workspace-header"><div><p className="eyebrow">CALLING CREDIT</p><h1>Top up balance</h1></div></header>
    <div className="wallet-layout">
      <div className="wallet-balance"><span className="balance-icon"><CircleDollarSign size={21} /></span><div><small>AVAILABLE TELNYX CREDIT</small><strong>${balance.toFixed(2)}</strong><p>Calls are deducted directly from this balance.</p></div><span>USD</span></div>
      <div className="payment-panel">
        <div className="payment-heading"><span><CreditCard size={20} /></span><div><h2>Vocivo billing</h2><p>Calling credit and subscription payments are managed by Vocivo without exposing the underlying carrier account.</p></div></div>
        <div className="payment-facts"><span><Check size={16} /><strong>Account</strong><small>Vocivo calling credit</small></span><span><ShieldCheck size={16} /><strong>Payment security</strong><small>Secure billing support</small></span><span><WalletCards size={16} /><strong>Currency</strong><small>USD</small></span></div>
        <button className="topup-button" disabled={preview} onClick={() => window.location.href = 'mailto:billing@vocivo.app?subject=Vocivo%20calling%20credit'}><CreditCard size={19} /> Contact Vocivo billing</button>
        <p className="payment-note">Online self-service payment processing will be enabled when the Vocivo billing provider is connected.</p>
      </div>
    </div>
  </section>;
}

function HistoryView({ history, onCallAgain }) {
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">ACTIVITY</p><h1>Recent calls</h1></div></header><div className="history-list">{history.length === 0 ? <div className="empty-state"><Clock3 /><h2>No calls yet</h2><p>Your browser call history will appear here.</p></div> : history.map((item) => <article key={item.id} className="history-item"><span className={`history-direction ${item.direction}`}>{item.direction === 'incoming' ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{formatPhone(item.number)}</strong><small>{new Date(item.date).toLocaleString()}</small></div><span className="duration">{formatDuration(item.duration)}</span><button onClick={() => onCallAgain(item.number)} title="Call again"><Phone size={17} /></button></article>)}</div></section>;
}

function RatesView({ rates }) {
  const [search, setSearch] = useState('');
  const filtered = rates.filter((rate) => `${rate.country_name} ${rate.country_code} ${rate.dial_code}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="content-view"><header className="workspace-header"><div><p className="eyebrow">WORLDWIDE</p><h1>Country codes</h1></div><div className="view-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Country or code" /></div></header><div className="rates-list">{filtered.map((rate) => <article key={rate.id} className="rate-item"><span className="rate-code">{rate.country_code}</span><div><strong>{rate.country_name}</strong><small>International destination</small></div><strong>{rate.dial_code} {rate.rate_per_min ? <small>from ${rate.rate_per_min.toFixed(3)}/min</small> : <small>Vocivo live rate</small>}</strong></article>)}</div><p className="rate-note">Vocivo accepts complete international numbers in E.164 format. Final pricing varies by number type and destination network.</p></section>;
}

function VerifiedNumbersPanel({ numbers, pending, busy, error, preview, onRequest, onVerify, onRemove, onCancel }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [method, setMethod] = useState('sms');
  const [code, setCode] = useState('');

  return (
    <div className="settings-section verified-section">
      <div className="section-heading"><div><h2>Verified caller IDs</h2><p>Use a number you already own as the caller ID for outgoing calls.</p></div></div>
      {numbers.map((number) => <div className="setting-row" key={number.id}><span className="setting-icon good"><Check /></span><div><strong>{number.phone_number}</strong><small>Verified for outgoing caller ID</small></div>{!preview && <button className="icon-danger" onClick={() => onRemove(number.phone_number)} title="Remove verified number"><Trash2 size={16} /></button>}</div>)}

      {!preview && !pending && <form className="verification-form" onSubmit={(event) => { event.preventDefault(); onRequest(phoneNumber, method); }}>
        <label>Phone number<input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+966 50 123 4567" inputMode="tel" required /></label>
        <div className="verification-method" aria-label="Verification method"><button type="button" className={method === 'sms' ? 'active' : ''} onClick={() => setMethod('sms')}>Text message</button><button type="button" className={method === 'call' ? 'active' : ''} onClick={() => setMethod('call')}>Voice call</button></div>
        <button className="add-number-button" disabled={busy}><Plus size={17} /> {busy ? 'Sending code...' : 'Add and verify'}</button>
      </form>}

      {!preview && pending && <form className="verification-form code-form" onSubmit={(event) => { event.preventDefault(); onVerify(pending.phone_number, code); }}>
        <div className="verification-copy"><strong>Enter the code sent to {pending.phone_number}</strong><small>Vocivo sent it by {pending.verification_method === 'call' ? 'voice call' : 'text message'}.</small>{pending.verification_method === 'sms' && <button type="button" className="voice-fallback" onClick={() => onRequest(pending.phone_number, 'call')} disabled={busy}><PhoneCall size={14} /> No text? Send by voice call</button>}</div>
        <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="123456" inputMode="numeric" autoFocus required /></label>
        <div className="verification-actions"><button type="button" className="secondary-small" onClick={onCancel}>Cancel</button><button className="add-number-button" disabled={busy}>{busy ? 'Checking...' : 'Confirm number'}</button></div>
      </form>}
      {error && <div className="inline-error verification-error">{error}</div>}
      {preview && <p className="settings-note">Sign in to add or verify a caller ID.</p>}
    </div>
  );
}

function SettingsView({ profile, ownedNumbers, verifiedNumbers, voice, preview, verification, onLogout }) {
  return (
    <section className="content-view settings-view">
      <header className="workspace-header"><div><p className="eyebrow">ACCOUNT</p><h1>Phone settings</h1></div></header>
      <div className="settings-section"><h2>Connection</h2><div className="setting-row"><span className={voice.ready ? 'setting-icon good' : 'setting-icon'}>{voice.ready ? <Wifi /> : <WifiOff />}</span><div><strong>Vocivo web phone</strong><small>{preview ? 'Preview mode does not connect to the voice service.' : voice.statusLabel}</small></div><span className={voice.ready ? 'state good' : 'state'}>{voice.ready ? 'Connected' : preview ? 'Preview' : 'Waiting'}</span></div><div className="setting-row"><span className="setting-icon"><Mic /></span><div><strong>Microphone</strong><small>Your browser will ask before sharing audio.</small></div><span className="state">Browser managed</span></div></div>
      <div className="settings-section"><div className="section-heading"><div><h2>Incoming Vocivo numbers</h2><p>Calls to these assigned numbers ring Vocivo while the web phone is connected.</p></div></div>{ownedNumbers.map((number) => <div className="setting-row" key={number.id}><span className="setting-icon"><PhoneIncoming /></span><div><strong>{number.phone_number}</strong><small>{number.label}</small></div><span className={number.receives_calls ? 'state good' : 'state'}>{number.receives_calls ? 'Incoming enabled' : 'Needs routing'}</span></div>)}</div>
      <VerifiedNumbersPanel numbers={verifiedNumbers} pending={verification.pending} busy={verification.busy} error={verification.error} preview={preview} onRequest={verification.request} onVerify={verification.verify} onRemove={verification.remove} onCancel={verification.cancel} />
      <div className="settings-section"><h2>Profile</h2><div className="setting-row">{profile.photo_url ? <img className="settings-avatar" src={profile.photo_url} alt={profile.full_name} /> : <span className="setting-icon"><ContactRound /></span>}<div><strong>{profile.full_name}</strong><small>{profile.job_title || profile.department || profile.email}</small><small>{[profile.mobile, profile.location].filter(Boolean).join(' · ')}</small></div><button className="logout-button" onClick={onLogout}><LogOut size={16} /> Sign out</button></div></div>
    </section>
  );
}

export default function App() {
  const initialSession = getStoredSession();
  const [session, setSession] = useState(initialSession);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialSession));
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(0);
  const [rates, setRates] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [verifiedNumbers, setVerifiedNumbers] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [view, setView] = useState(() => window.location.pathname.startsWith('/admin') ? 'admin' : 'dialer');
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('vocivo.history') || '[]'); } catch { return []; } });
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [verificationPending, setVerificationPending] = useState(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const voiceIdentity = useMemo(() => ({ name: profile?.full_name || 'Vocivo', extension: profile?.extension }), [profile?.extension, profile?.full_name]);
  const voice = useTelnyxVoice(session?.token, !preview && Boolean(session) && Boolean(profile) && profile?.admin_only !== true, voiceIdentity);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const sessionData = await api('/api/auth/session');
        let resolvedProfile = sessionData.profile;
        if (!active) return;
        setProfile(resolvedProfile);
        if (resolvedProfile.admin_only) {
          setBalance(0); setRates([]); setNumbers([]); setVerifiedNumbers([]); setSelectedNumber(null); setView('admin');
          return;
        }
        let bootstrap;
        try {
          bootstrap = await api('/api/mobile/bootstrap');
        } catch (loadError) {
          if (active) setNotice(loadError.message || 'Some account details could not be refreshed.');
          return;
        }
        if (!active) return;
        resolvedProfile = { ...resolvedProfile, ...bootstrap.profile };
        const owned = (bootstrap.numbers || []).filter((number) => number.source === 'owned');
        const verified = (bootstrap.numbers || []).filter((number) => number.source === 'verified');
        setProfile(resolvedProfile);
        setBalance(Number(bootstrap.account?.balance) || 0);
        setRates(buildDialingDirectory(bootstrap.account?.rates || []));
        setNumbers(owned);
        setVerifiedNumbers(verified);
        setSelectedNumber(owned[0] || verified[0] || null);
      } catch {
        clearSession();
        if (active) setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session]);
  useEffect(() => {
    if (!voice.connected) { setElapsed(0); return undefined; }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [voice.connected]);
  useEffect(() => {
    if (!voice.endedCall) return;
    setHistory((current) => { const next = [{ id: `${Date.now()}`, number: voice.endedCall.number, direction: voice.endedCall.direction, duration: elapsed, date: new Date().toISOString() }, ...current].slice(0, 40); localStorage.setItem('vocivo.history', JSON.stringify(next)); return next; });
  }, [voice.endedCall]);
  const shellData = useMemo(() => preview ? { profile: { full_name: 'Vocivo Owner', email: 'preview@vocivo.app' }, balance: 42.8, rates: SAMPLE_DIRECTORY, numbers: [SAMPLE_NUMBER], verifiedNumbers: [] } : { profile, balance, rates, numbers, verifiedNumbers }, [preview, profile, balance, rates, numbers, verifiedNumbers]);
  const canAdmin = ['superadmin', 'company_owner', 'company_admin', 'owner', 'admin'].includes(shellData.profile?.role || '');
  const callerNumbers = useMemo(() => [...shellData.numbers, ...shellData.verifiedNumbers], [shellData.numbers, shellData.verifiedNumbers]);
  useEffect(() => { if (preview) setSelectedNumber(SAMPLE_NUMBER); }, [preview]);
  useEffect(() => {
    if (view === 'admin' && profile && !canAdmin) setView('dialer');
  }, [canAdmin, profile, view]);
  function logout() { voice.disconnect(); clearSession(); setSession(null); setPreview(false); setProfile(null); }
  async function refreshVerifiedNumbers() {
    const result = await api('/api/telnyx/verified-numbers');
    setVerifiedNumbers(result.numbers || []);
  }
  async function requestVerification(phoneNumber, verificationMethod) {
    setVerificationBusy(true); setVerificationError('');
    try {
      const result = await api('/api/telnyx/verified-numbers', { method: 'POST', body: { action: 'request', phone_number: phoneNumber, verification_method: verificationMethod } });
      setVerificationPending({ phone_number: result.phone_number || phoneNumber.replace(/[\s()-]/g, ''), verification_method: verificationMethod });
    } catch (error) { setVerificationError(error.message); } finally { setVerificationBusy(false); }
  }
  async function confirmVerification(phoneNumber, code) {
    setVerificationBusy(true); setVerificationError('');
    try {
      await api('/api/telnyx/verified-numbers', { method: 'POST', body: { action: 'verify', phone_number: phoneNumber, verification_code: code } });
      await refreshVerifiedNumbers(); setVerificationPending(null); setNotice(`${phoneNumber} is ready as an outgoing caller ID.`);
    } catch (error) { setVerificationError(error.message); } finally { setVerificationBusy(false); }
  }
  async function removeVerifiedNumber(phoneNumber) {
    setVerificationBusy(true); setVerificationError('');
    try {
      await api(`/api/telnyx/verified-numbers?phone_number=${encodeURIComponent(phoneNumber)}`, { method: 'DELETE' });
      await refreshVerifiedNumbers();
      if (selectedNumber?.phone_number === phoneNumber) setSelectedNumber(numbers[0] || null);
      setNotice(`${phoneNumber} was removed from caller IDs.`);
    } catch (error) { setVerificationError(error.message); } finally { setVerificationBusy(false); }
  }
  if (!session && !preview) return <Login onLogin={setSession} onPreview={() => { setPreview(true); setLoading(false); }} />;
  if (loading) return <div className="loading-screen"><span className="brand-mark"><Globe2 /></span><p>Opening your phone...</p></div>;
  const navItems = [['dialer', Phone, 'Dialer'], ['history', History, 'Calls'], ...(shellData.profile?.account_type === 'business' ? [] : [['wallet', WalletCards, 'Top up']]), ['rates', Globe2, 'Countries'], ['settings', Settings, 'Settings'], ...(canAdmin ? [['admin', ShieldCheck, shellData.profile?.role === 'superadmin' ? 'Superadmin' : 'Company admin']] : [])];
  return (
    <div className={`app-shell ${view === 'admin' ? 'admin-mode' : ''}`}>
      {view !== 'admin' && <aside className="side-nav"><div className="brand-lockup"><span className="brand-mark"><Globe2 size={22} /></span><span>Vocivo</span></div><nav>{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span></button>)}</nav><div className="side-footer">{shellData.profile?.photo_url ? <img className="account-avatar" src={shellData.profile.photo_url} alt={shellData.profile.full_name} /> : <div className="account-avatar">{(shellData.profile?.organization_name || shellData.profile?.full_name)?.charAt(0) || 'V'}</div>}<div><strong>{shellData.profile?.account_type === 'business' ? shellData.profile?.organization_name : shellData.profile?.full_name}</strong><small>{preview ? 'Preview workspace' : shellData.profile?.account_type === 'business' ? `${shellData.profile?.full_name} · ${String(shellData.profile?.role || 'user').replaceAll('_', ' ')}` : shellData.profile?.role === 'superadmin' ? 'Platform superadmin' : 'Individual account'}</small></div><button onClick={logout} title={preview ? 'Exit preview' : 'Sign out'}><LogOut size={17} /></button></div></aside>}
      <main className="main-area">
        {preview && <div className="preview-banner"><span>You are viewing a safe preview. Calls are disabled.</span><button onClick={logout}><X size={15} /> Exit preview</button></div>}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
        {view === 'dialer' && <Dialer balance={shellData.balance} rates={shellData.rates} numbers={callerNumbers} selectedNumber={selectedNumber} setSelectedNumber={setSelectedNumber} voice={voice} preview={preview} accountType={shellData.profile?.account_type || 'individual'} onPreviewCall={() => setNotice('Sign in to place a real call.')} />}
        {view === 'history' && <HistoryView history={history} onCallAgain={(value) => { setView('dialer'); setNotice(`Ready to call ${formatPhone(value)} from the dialer.`); }} />}
        {view === 'wallet' && <WalletView balance={shellData.balance} preview={preview} />}
        {view === 'rates' && <RatesView rates={shellData.rates} />}
        {view === 'settings' && <SettingsView profile={shellData.profile} ownedNumbers={shellData.numbers} verifiedNumbers={shellData.verifiedNumbers} voice={voice} preview={preview} verification={{ pending: verificationPending, busy: verificationBusy, error: verificationError, request: requestVerification, verify: confirmVerification, remove: removeVerifiedNumber, cancel: () => { setVerificationPending(null); setVerificationError(''); } }} onLogout={logout} />}
        {view === 'admin' && !preview && canAdmin && <AdminConsole profile={shellData.profile} />}
        {view === 'admin' && !preview && !canAdmin && <section className="content-view"><div className="empty-state"><ShieldCheck /><h2>Administrator access required</h2></div></section>}
        {view === 'admin' && preview && <section className="content-view"><div className="empty-state"><ShieldCheck /><h2>Admin requires sign in</h2><p>Exit preview and sign in with the owner account to manage the phone system.</p></div></section>}
      </main>
      {view !== 'admin' && <nav className="mobile-nav">{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon /><span>{label}</span></button>)}</nav>}
      <audio id="remoteMedia" autoPlay playsInline />
      {voice.incomingCall && <IncomingCall call={voice.incomingCall} onAnswer={voice.answer} onDecline={voice.decline} />}
      {voice.active && <ActiveCall voice={voice} number={voice.dialedNumber} elapsed={elapsed} />}
    </div>
  );
}
