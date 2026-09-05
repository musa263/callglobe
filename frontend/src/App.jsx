import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Globe2, History, LogOut, Phone, Settings, ShieldCheck, WalletCards, X } from "lucide-react";
import { api, clearSession, getStoredSession, storeSession } from "./shared/api";
import { buildDialingDirectory } from "./features/numbers/countries";
import { useVoice } from "./features/calling/hooks/useVoice";
import { readHistory, writeHistory } from "./features/calling/history/historyStorage.js";
import { formatPhone } from "./features/calling/formatting.js";
import { Login } from "./features/auth/Login.jsx";
import { IncomingCall } from "./features/calling/components/IncomingCall.jsx";
import { ActiveCall } from "./features/calling/components/ActiveCall.jsx";
import { Dialer } from "./features/calling/components/Dialer.jsx";
import { WalletView } from "./features/billing/WalletView.jsx";
import { HistoryView } from "./features/calling/history/HistoryView.jsx";
import { RatesView } from "./features/numbers/RatesView.jsx";
import { SettingsView } from "./features/settings/SettingsView.jsx";
import { OpeningScreen } from './shared/components/OpeningScreen.jsx';

const AdminConsole = lazy(() => import('./features/admin/AdminConsole'));

export default function App() {
  const initialSession = getStoredSession();
  const [session, setSession] = useState(initialSession);
  const [loading, setLoading] = useState(Boolean(initialSession));
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(null);
  const [rates, setRates] = useState([]);
  const [numbers, setNumbers] = useState([]);
  const [verifiedNumbers, setVerifiedNumbers] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [view, setView] = useState(() => window.location.pathname.startsWith('/admin') ? 'admin' : 'dialer');
  const [history, setHistory] = useState([]);
  const [pendingDial, setPendingDial] = useState('');
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [verificationPending, setVerificationPending] = useState(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const voiceIdentity = useMemo(() => ({ name: profile?.full_name || 'Vocivo', extension: profile?.extension }), [profile?.extension, profile?.full_name]);
  // Authentication is verified through the httpOnly cookie above. This key
  // identifies the verified account; a browser-stored bearer is not required.
  const voiceSessionKey = profile?.id ? JSON.stringify([profile.organization_id, profile.id]) : null;
  const voice = useVoice(voiceSessionKey, Boolean(session) && Boolean(profile) && profile?.admin_only !== true, voiceIdentity);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        // Both requests at once: on a cold start each is a separate function
        // warming up, and the opening screen sat for the sum of the two.
        const bootstrapRequest = api('/api/mobile/bootstrap').then((result) => ({ result }), (failure) => ({ failure }));
        const sessionData = await api('/api/auth/session');
        let resolvedProfile = sessionData.profile;
        if (!active) return;
        setProfile(resolvedProfile);
        setHistory(readHistory(resolvedProfile.id || session.sub));
        setLoading(false);
        if (resolvedProfile.admin_only) {
          setBalance(null); setRates([]); setNumbers([]); setVerifiedNumbers([]); setSelectedNumber(null); setView('admin');
          return;
        }
        const { result: bootstrap, failure: loadError } = await bootstrapRequest;
        if (!active) return;
        if (!bootstrap) {
          setNotice(loadError?.message || 'Some account details could not be refreshed.');
          return;
        }
        resolvedProfile = { ...resolvedProfile, ...bootstrap.profile };
        const owned = (bootstrap.numbers || []).filter((number) => number.source === 'owned');
        const verified = (bootstrap.numbers || []).filter((number) => number.source === 'verified');
        setProfile(resolvedProfile);
        setBalance(bootstrap.account?.balance == null ? null : Number(bootstrap.account.balance));
        setRates(buildDialingDirectory(bootstrap.account?.rates || []));
        setNumbers(owned);
        setVerifiedNumbers(verified);
        setSelectedNumber(owned[0] || verified[0] || null);
      } catch (sessionError) {
        if (!active) return;
        if ([401, 403].includes(sessionError?.status)) {
          // The session really is over.
          clearSession();
          setSession(null);
          return;
        }
        // A blip or a server error is not a sign-out: the stored session is
        // still good, and dropping to the login screen mid-call unmounted the
        // phone. Say so, stay, and try again shortly.
        setNotice(sessionError?.message || 'Your account details could not be refreshed. Retrying shortly.');
        setTimeout(() => { if (active) setSession((current) => (current ? { ...current } : current)); }, 8000);
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
    const userId = profile?.id || session?.sub;
    setHistory((current) => {
      const next = [{ id: voice.endedCall.id || `${Date.now()}`, number: voice.endedCall.number, direction: voice.endedCall.direction, duration: Number(voice.endedCall.duration) || 0, date: new Date().toISOString() }, ...current].slice(0, 40);
      writeHistory(userId, next);
      return next;
    });
  }, [voice.endedCall]);
  const shellData = useMemo(() => ({ profile, balance, rates, numbers, verifiedNumbers }), [profile, balance, rates, numbers, verifiedNumbers]);
  const canAdmin = ['superadmin', 'company_owner', 'company_admin', 'owner', 'admin'].includes(shellData.profile?.role || '');
  const callerNumbers = useMemo(() => [...shellData.numbers, ...shellData.verifiedNumbers], [shellData.numbers, shellData.verifiedNumbers]);
  useEffect(() => {
    if (view === 'admin' && profile && !canAdmin) setView('dialer');
  }, [canAdmin, profile, view]);
  useEffect(() => {
    if (view !== 'dialer') setPendingDial('');
  }, [view]);
  function logout() {
    voice.disconnect();
    api('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    clearSession();
    setSession(null);
    setProfile(null);
    setHistory([]);
    setPendingDial('');
  }
  async function submitForcedPassword(event) {
    event.preventDefault();
    if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    setPasswordError('');
    try {
      const result = await api('/api/auth/password', { method: 'POST', body: { current_password: passwordDraft.currentPassword, new_password: passwordDraft.newPassword } });
      if (result.token) {
        const next = { ...getStoredSession(), token: result.token };
        storeSession(next);
        setSession(next);
      }
      setProfile((current) => current ? { ...current, force_password_change: false } : current);
      setPasswordDraft({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      setPasswordError(error.message);
    } finally {
      setPasswordBusy(false);
    }
  }
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
  if (!session) return <Login onLogin={setSession} />;
  if (loading) return <OpeningScreen name={profile?.full_name || initialSession?.profile?.full_name || ''} />;
  const navItems = [['dialer', Phone, 'Dialer'], ['history', History, 'Calls'], ...(shellData.profile?.account_type === 'business' ? [] : [['wallet', WalletCards, 'Top up']]), ['rates', Globe2, 'Countries'], ['settings', Settings, 'Settings'], ...(canAdmin ? [['admin', ShieldCheck, shellData.profile?.role === 'superadmin' ? 'Superadmin' : 'Company admin']] : [])];
  return (
    <div className={`app-shell ${view === 'admin' ? 'admin-mode' : ''}`}>
      {view !== 'admin' && <aside className="side-nav"><div className="brand-lockup"><span className="brand-mark"><Globe2 size={22} /></span><span>Vocivo</span></div><nav>{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span></button>)}</nav><div className="side-footer">{shellData.profile?.photo_url ? <img className="account-avatar" src={shellData.profile.photo_url} alt={shellData.profile.full_name} /> : <div className="account-avatar">{(shellData.profile?.organization_name || shellData.profile?.full_name)?.charAt(0) || 'V'}</div>}<div><strong>{shellData.profile?.role === 'superadmin' ? shellData.profile?.organization_name || 'Vocivo Communications' : shellData.profile?.account_type === 'business' ? shellData.profile?.organization_name : shellData.profile?.full_name}</strong><small>{shellData.profile?.role === 'superadmin' ? `${shellData.profile?.full_name} · Platform superadmin` : shellData.profile?.account_type === 'business' ? `${shellData.profile?.full_name} · ${String(shellData.profile?.role || 'user').replaceAll('_', ' ')}` : 'Individual account'}</small></div><button onClick={logout} title="Sign out"><LogOut size={17} /></button></div></aside>}
      <main className="main-area">
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
        {profile?.force_password_change && <div className="modal-layer" role="dialog" aria-modal="true"><section className="modal"><header><div><h2>Update your password</h2><p>This account requires a new password before you can continue.</p></div></header><form className="modal-form" onSubmit={submitForcedPassword}><label>Current password<input type="password" autoComplete="current-password" value={passwordDraft.currentPassword} onChange={(event) => setPasswordDraft((current) => ({ ...current, currentPassword: event.target.value }))} required /></label><label>New password<input type="password" autoComplete="new-password" minLength={10} value={passwordDraft.newPassword} onChange={(event) => setPasswordDraft((current) => ({ ...current, newPassword: event.target.value }))} required /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={10} value={passwordDraft.confirmPassword} onChange={(event) => setPasswordDraft((current) => ({ ...current, confirmPassword: event.target.value }))} required /></label>{passwordError && <div className="form-error" role="alert">{passwordError}</div>}<button className="primary-button" type="submit" disabled={passwordBusy}>{passwordBusy ? 'Saving...' : 'Save password'}</button></form></section></div>}
        {view === 'dialer' && <Dialer balance={shellData.balance} rates={shellData.rates} numbers={callerNumbers} selectedNumber={selectedNumber} setSelectedNumber={setSelectedNumber} voice={voice} accountType={shellData.profile?.account_type || 'individual'} initialNumber={pendingDial} />}
        {view === 'history' && <HistoryView history={history} onCallAgain={(value) => { setPendingDial(value); setView('dialer'); setNotice(`Ready to call ${formatPhone(value)} from the dialer.`); }} />}
        {view === 'wallet' && <WalletView balance={shellData.balance} />}
        {view === 'rates' && <RatesView rates={shellData.rates} />}
        {view === 'settings' && <SettingsView profile={shellData.profile} ownedNumbers={shellData.numbers} verifiedNumbers={shellData.verifiedNumbers} voice={voice} verification={{ pending: verificationPending, busy: verificationBusy, error: verificationError, request: requestVerification, verify: confirmVerification, remove: removeVerifiedNumber, cancel: () => { setVerificationPending(null); setVerificationError(''); } }} onLogout={logout} />}
        {view === 'admin' && canAdmin && <Suspense fallback={<div className="loading-screen" role="status" aria-label="Loading administration"><div className="loading-track" aria-hidden="true"><span /></div></div>}><AdminConsole profile={shellData.profile} /></Suspense>}
        {view === 'admin' && !canAdmin && <section className="content-view"><div className="empty-state"><ShieldCheck /><h2>Administrator access required</h2></div></section>}
      </main>
      {view !== 'admin' && <nav className="mobile-nav">{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon /><span>{label}</span></button>)}</nav>}
      <audio id="remoteMedia" autoPlay playsInline />
      {voice.incomingCall && <IncomingCall call={voice.incomingCall} onAnswer={voice.answer} onDecline={voice.decline} />}
      {voice.active && <ActiveCall voice={voice} number={voice.dialedNumber} elapsed={elapsed} selectedNumber={selectedNumber} profile={shellData.profile} />}
    </div>
  );
}
