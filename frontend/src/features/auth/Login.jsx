import { useState } from "react";
import { ContactRound, Globe2, PhoneCall, PhoneIncoming, ShieldCheck } from "lucide-react";
import { api, storeSession } from "../../shared/api";

export function Login({ onLogin }) {
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
        </form>
      </section>
    </main>
  );
}
