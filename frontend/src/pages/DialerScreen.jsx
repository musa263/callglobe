// src/pages/DialerScreen.jsx
import React, { useState } from 'react';
import CountryPicker from '../components/CountryPicker';

export default function DialerScreen({
  balance, estimatedMinutes, selectedCountry, onSelectCountry,
  dialNumber, onDialNumber, onCall, rates, voiceReady,
}) {
  const [showPicker, setShowPicker] = useState(false);

  const dialPad = (digit) => {
    if (dialNumber.length < 15) onDialNumber(dialNumber + digit);
  };

  const canCall = dialNumber && balance > 0 && voiceReady;

  return (
    <div style={{ padding: '0 20px', paddingBottom: 100 }}>
      {/* Balance card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,212,170,0.08), rgba(0,153,255,0.08))',
        borderRadius: 18, padding: '18px 20px', marginBottom: 20,
        border: '1px solid rgba(0,212,170,0.1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ color: '#6a7a8a', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Balance</p>
            <p style={{ fontSize: 28, fontWeight: 700, marginTop: 2, background: 'linear-gradient(135deg, #00d4aa, #0099ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              ${balance.toFixed(2)}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#6a7a8a', fontSize: 12 }}>~{estimatedMinutes} min</p>
            <p style={{ color: '#5a6a7a', fontSize: 11 }}>to {selectedCountry?.country_name || '—'}</p>
          </div>
        </div>
        {!voiceReady && (
          <p style={{ color: '#f0a030', fontSize: 11, marginTop: 8 }}>Connecting to call server...</p>
        )}
      </div>

      {/* Country + number */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', borderRadius: 16,
        padding: '14px 16px', marginBottom: 16,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setShowPicker(true)} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10,
            padding: '8px 12px', color: '#fff', fontSize: 15, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}>
            <span style={{ fontSize: 20 }}>{selectedCountry?.flag || '🌍'}</span>
            <span style={{ fontWeight: 600 }}>{selectedCountry?.dial_code || '+1'}</span>
            <span style={{ color: '#5a6a7a', fontSize: 12 }}>▼</span>
          </button>
          <div style={{
            flex: 1, fontSize: 22, fontWeight: 600, letterSpacing: '0.03em',
            color: dialNumber ? '#fff' : '#3a4a5a', minHeight: 32,
            display: 'flex', alignItems: 'center', fontVariantNumeric: 'tabular-nums',
          }}>
            {dialNumber || 'Enter number'}
          </div>
          {dialNumber && (
            <button onClick={() => onDialNumber(dialNumber.slice(0, -1))} style={{
              background: 'none', border: 'none', color: '#6a7a8a', fontSize: 18, cursor: 'pointer', padding: '4px 8px',
            }}>⌫</button>
          )}
        </div>
        {dialNumber && selectedCountry && (
          <p style={{ color: '#5a6a7a', fontSize: 12, marginTop: 8, marginLeft: 4 }}>
            Rate: ${selectedCountry.rate_per_min}/min to {selectedCountry.country_name}
          </p>
        )}
      </div>

      {/* Dial pad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 300, margin: '0 auto' }}>
        {['1','2','3','4','5','6','7','8','9','*','0','#'].map((d) => (
          <button key={d} onClick={() => dialPad(d)} style={{
            height: 56, borderRadius: 16, border: 'none',
            background: 'rgba(255,255,255,0.04)', color: '#fff',
            fontSize: 22, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {d}
          </button>
        ))}
      </div>

      {/* Call button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <button onClick={onCall} disabled={!canCall} style={{
          width: 64, height: 64, borderRadius: '50%', border: 'none',
          background: canCall ? 'linear-gradient(135deg, #00d4aa, #00b894)' : 'rgba(255,255,255,0.06)',
          cursor: canCall ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: canCall ? '0 4px 24px rgba(0,212,170,0.3)' : 'none',
          transition: 'all 0.2s',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </button>
      </div>

      {showPicker && (
        <CountryPicker
          rates={rates}
          selected={selectedCountry}
          onSelect={(c) => { onSelectCountry(c); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
