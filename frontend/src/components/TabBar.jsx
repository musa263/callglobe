// src/components/TabBar.jsx
import React from 'react';

const tabs = [
  { id: 'dialer', icon: '📱', label: 'Dialer' },
  { id: 'history', icon: '🕐', label: 'History' },
  { id: 'recharge', icon: '💳', label: 'Recharge' },
  { id: 'rates', icon: '🌍', label: 'Rates' },
];

export default function TabBar({ active, onChange }) {
  return (
    <div className="app-tabbar" style={{
      display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '8px 0 28px', background: 'rgba(10,10,15,0.95)',
      backdropFilter: 'blur(20px)',
    }}>
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          flex: 1, background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          color: active === tab.id ? '#00d4aa' : '#4a5a6a',
          transition: 'color 0.2s',
        }}>
          <span style={{ fontSize: 20 }}>{tab.icon}</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' }}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
