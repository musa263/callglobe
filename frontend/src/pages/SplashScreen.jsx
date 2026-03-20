// src/pages/SplashScreen.jsx
import React from 'react';

const s = {
  container: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(160deg, #0a0a0a 0%, #1a0a2e 40%, #0d1b3e 70%, #0a0a0a 100%)',
  },
  logo: {
    width: 80, height: 80, borderRadius: 24,
    background: 'linear-gradient(135deg, #00d4aa, #0099ff)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 60px rgba(0, 212, 170, 0.3)',
    animation: 'pulse 2s ease-in-out infinite',
  },
  title: {
    marginTop: 24, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em',
    background: 'linear-gradient(135deg, #00d4aa, #0099ff)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  sub: { color: '#5a6a7a', fontSize: 14, marginTop: 8, letterSpacing: '0.1em', textTransform: 'uppercase' },
};

export default function SplashScreen() {
  return (
    <div style={s.container}>
      <div style={s.logo}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
        </svg>
      </div>
      <h1 style={s.title}>CallGlobe</h1>
      <p style={s.sub}>Call anywhere. Pay less.</p>
    </div>
  );
}
