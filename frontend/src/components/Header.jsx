// src/components/Header.jsx
import React from 'react';

export default function Header({ profile, onSignOut }) {
  return (
    <div className="app-header" style={{
      padding: '50px 20px 14px', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'linear-gradient(135deg, #00d4aa, #0099ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>CallGlobe</span>
      </div>
      <button onClick={onSignOut} style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(0,212,170,0.2), rgba(0,153,255,0.2))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: '#00d4aa', border: 'none', cursor: 'pointer',
      }}>
        {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
      </button>
    </div>
  );
}
