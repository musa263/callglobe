// src/pages/AuthScreen.jsx
import React, { useState } from 'react';

const input = {
  padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 15, outline: 'none', width: '100%',
};

export default function AuthScreen({ auth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    if (mode === 'login') {
      await auth.signIn(email, password);
    } else {
      await auth.signUp(email, password, name);
    }
    setLoading(false);
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(160deg, #0a0a0a 0%, #1a0a2e 40%, #0d1b3e 70%, #0a0a0a 100%)',
      color: '#fff', padding: '60px 24px 24px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
          background: 'linear-gradient(135deg, #00d4aa, #0099ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>CallGlobe</h1>
        <p style={{ color: '#6a7a8a', marginTop: 6, fontSize: 14 }}>Affordable calls worldwide</p>
      </div>

      {/* Tab toggle */}
      <div style={{
        display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4, marginBottom: 28,
      }}>
        {['login', 'signup'].map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
            background: mode === m ? 'rgba(0,212,170,0.15)' : 'transparent',
            color: mode === m ? '#00d4aa' : '#6a7a8a',
            fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
          }}>
            {m === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'signup' && (
          <input placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} style={input} />
        )}
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          style={input} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
      </div>

      {auth.error && (
        <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{auth.error}</p>
      )}

      <button onClick={handleSubmit} disabled={loading} style={{
        marginTop: 24, padding: '16px 0', borderRadius: 14, border: 'none',
        background: 'linear-gradient(135deg, #00d4aa, #0099ff)',
        color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
        boxShadow: '0 4px 24px rgba(0,212,170,0.25)',
        opacity: loading ? 0.6 : 1,
      }}>
        {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'}
      </button>

      {mode === 'signup' && (
        <p style={{ textAlign: 'center', marginTop: 16, color: '#5a6a7a', fontSize: 13 }}>
          Add balance after signup to start calling.
        </p>
      )}
    </div>
  );
}
