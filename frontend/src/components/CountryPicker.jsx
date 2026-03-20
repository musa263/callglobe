// src/components/CountryPicker.jsx
import React, { useState } from 'react';

export default function CountryPicker({ rates, selected, onSelect, onClose }) {
  const [search, setSearch] = useState('');

  const filtered = rates.filter(
    (c) => c.country_name.toLowerCase().includes(search.toLowerCase()) ||
           c.dial_code.includes(search) ||
           c.country_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.92)', zIndex: 100,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '50px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: '#00d4aa', fontSize: 16, cursor: 'pointer',
        }}>
          ← Back
        </button>
        <input
          placeholder="Search country or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 14, outline: 'none',
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
        {filtered.map((c) => (
          <button key={c.id} onClick={() => onSelect(c)} style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%',
            padding: '14px 8px', background: 'none', border: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            color: '#fff', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 24 }}>{c.flag}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 15, fontWeight: 500 }}>{c.country_name}</p>
              <p style={{ color: '#5a6a7a', fontSize: 13 }}>{c.dial_code}</p>
            </div>
            <span style={{ color: '#00d4aa', fontSize: 13, fontWeight: 600 }}>
              ${c.rate_per_min}/min
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
