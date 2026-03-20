// src/pages/RatesScreen.jsx
import React, { useState } from 'react';

export default function RatesScreen({ rates }) {
  const [search, setSearch] = useState('');

  const filtered = rates.filter(
    (c) => c.country_name.toLowerCase().includes(search.toLowerCase()) ||
           c.dial_code.includes(search)
  );

  return (
    <div style={{ padding: '0 20px', paddingBottom: 100 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, letterSpacing: '-0.01em' }}>Call Rates</h2>
      <input
        placeholder="Search country..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div>
        {filtered.map((c) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <span style={{ fontSize: 24 }}>{c.flag}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500 }}>{c.country_name}</p>
              <p style={{ color: '#5a6a7a', fontSize: 12 }}>{c.dial_code}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: '#00d4aa', fontSize: 15, fontWeight: 700 }}>${c.rate_per_min}</p>
              <p style={{ color: '#4a5a6a', fontSize: 11 }}>per min</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
