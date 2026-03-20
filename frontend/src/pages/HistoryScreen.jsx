// src/pages/HistoryScreen.jsx
import React from 'react';

const formatDuration = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

const formatDate = (date) => {
  const d = new Date(date);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatTime = (date) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function HistoryScreen({ history }) {
  return (
    <div style={{ padding: '0 20px', paddingBottom: 100 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, letterSpacing: '-0.01em' }}>Call History</h2>

      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#4a5a6a' }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>📞</p>
          <p style={{ fontSize: 15, fontWeight: 500 }}>No calls yet</p>
          <p style={{ fontSize: 13, marginTop: 4, color: '#3a4a5a' }}>Your call history will appear here</p>
        </div>
      ) : (
        history.map((call) => (
          <div key={call.id} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%',
              background: call.status === 'completed' ? 'rgba(0,212,170,0.1)' : 'rgba(255,107,107,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
              color: call.status === 'completed' ? '#00d4aa' : '#ff6b6b',
            }}>
              {call.status === 'completed' ? '✓' : '✕'}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 15, fontWeight: 600 }}>{call.destination_number}</p>
              <p style={{ color: '#5a6a7a', fontSize: 13 }}>
                {call.destination_country_code} · {formatDuration(call.duration_seconds || 0)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: '#ff6b6b', fontSize: 14, fontWeight: 600 }}>
                -${(call.total_cost || 0).toFixed(2)}
              </p>
              <p style={{ color: '#4a5a6a', fontSize: 12 }}>
                {formatDate(call.started_at)} {formatTime(call.started_at)}
              </p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
