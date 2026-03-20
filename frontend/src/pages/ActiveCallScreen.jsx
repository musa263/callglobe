// src/pages/ActiveCallScreen.jsx
import React from 'react';

const formatDuration = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

export default function ActiveCallScreen({ telnyx, number, country, balance }) {
  const isConnected = telnyx.callState === 'connected';

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'space-between', padding: '60px 24px 50px',
      background: 'linear-gradient(160deg, #0a0a0a 0%, #0a1a2e 50%, #0a0a0a 100%)',
      color: '#fff',
    }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{
          color: isConnected ? '#00d4aa' : '#f0a030',
          fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          {isConnected ? 'Connected' : telnyx.callState === 'ringing' ? 'Ringing...' : 'Connecting...'}
        </p>
        <div style={{
          width: 90, height: 90, borderRadius: '50%', margin: '24px auto',
          background: 'linear-gradient(135deg, rgba(0,212,170,0.15), rgba(0,153,255,0.15))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid rgba(0,212,170,0.2)',
        }}>
          <span style={{ fontSize: 40 }}>{country?.flag || '🌍'}</span>
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700 }}>{number}</h2>
        <p style={{ color: '#5a6a7a', marginTop: 4, fontSize: 14 }}>{country?.country_name}</p>
        <p style={{
          fontSize: 40, fontWeight: 300, marginTop: 20, letterSpacing: '0.05em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatDuration(telnyx.callDuration)}
        </p>
        <p style={{ color: '#5a6a7a', fontSize: 13, marginTop: 4 }}>
          ${country?.rate_per_min}/min · Balance: ${balance.toFixed(2)}
        </p>
      </div>

      <div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 40, justifyContent: 'center' }}>
          <button onClick={telnyx.toggleMute} style={{
            width: 64, height: 64, borderRadius: '50%', border: 'none',
            background: telnyx.isMuted ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.06)',
            color: telnyx.isMuted ? '#00d4aa' : '#fff',
            fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {telnyx.isMuted ? '🔇' : '🎤'}
          </button>
        </div>

        {/* End call */}
        <button onClick={telnyx.endCall} style={{
          width: 72, height: 72, borderRadius: '50%', border: 'none',
          background: '#ff3b3b', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', margin: '0 auto',
          boxShadow: '0 4px 30px rgba(255,59,59,0.3)',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
