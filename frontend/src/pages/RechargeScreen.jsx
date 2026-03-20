// src/pages/RechargeScreen.jsx
import React, { useState } from 'react';

export default function RechargeScreen({ balance, packages, onRecharge }) {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleRecharge = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await onRecharge(selected.id);
    } catch (err) {
      console.error('Recharge error:', err);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '0 20px', paddingBottom: 100 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.01em' }}>Recharge</h2>
      <p style={{ color: '#5a6a7a', fontSize: 14, marginBottom: 20 }}>
        Current balance: <span style={{ color: '#00d4aa', fontWeight: 700 }}>${balance.toFixed(2)}</span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {packages.map((pkg) => (
          <button key={pkg.id} onClick={() => setSelected(pkg)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 18px', borderRadius: 14,
            border: `1px solid ${selected?.id === pkg.id ? 'rgba(0,212,170,0.4)' : 'rgba(255,255,255,0.06)'}`,
            background: selected?.id === pkg.id ? 'rgba(0,212,170,0.08)' : 'rgba(255,255,255,0.02)',
            color: '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
          }}>
            <div>
              <p style={{ fontSize: 20, fontWeight: 700 }}>{pkg.label}</p>
              {pkg.bonus_percent > 0 && (
                <p style={{ color: '#00d4aa', fontSize: 13, marginTop: 2 }}>+{pkg.bonus_percent}% bonus</p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 15, fontWeight: 600 }}>${pkg.credit.toFixed(2)}</p>
              <p style={{ color: '#5a6a7a', fontSize: 12 }}>total credit</p>
            </div>
          </button>
        ))}
      </div>

      <button onClick={handleRecharge} disabled={!selected || loading} style={{
        width: '100%', marginTop: 20, padding: '16px 0', borderRadius: 14,
        border: 'none', fontSize: 16, fontWeight: 700,
        cursor: selected && !loading ? 'pointer' : 'default',
        background: selected ? 'linear-gradient(135deg, #00d4aa, #0099ff)' : 'rgba(255,255,255,0.06)',
        color: selected ? '#fff' : '#4a5a6a',
        boxShadow: selected ? '0 4px 24px rgba(0,212,170,0.25)' : 'none',
        transition: 'all 0.2s', opacity: loading ? 0.6 : 1,
      }}>
        {loading ? 'Redirecting to Stripe...' : selected ? `Pay $${selected.amount.toFixed(2)} with Stripe` : 'Select an amount'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 }}>
        <span style={{ fontSize: 12 }}>🔒</span>
        <span style={{ color: '#4a5a6a', fontSize: 12 }}>Payments secured by Stripe</span>
      </div>
    </div>
  );
}
