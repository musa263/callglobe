import { useEffect, useState } from "react";

export const OPENING_PEOPLE = [
  { skin: '#f1c9a5', hair: '#3b2a20', shirt: '#176bba', x: 110, y: 8 },
  { skin: '#8d5a3b', hair: '#1c1412', shirt: '#0e4f91', x: 208, y: 86 },
  { skin: '#e8b48c', hair: '#6b3d22', shirt: '#4d8fd6', x: 172, y: 196 },
  { skin: '#5c3a26', hair: '#101010', shirt: '#9cc4ee', x: 48, y: 196 },
  { skin: '#f6d7bb', hair: '#a56b3b', shirt: '#2f7bc7', x: 12, y: 86 },
];

export const OPENING_LINES = ['Opening your phone', 'Connecting to your company network', 'Checking who is available'];

export function OpeningPerson({ skin, hair, shirt, x, y, delay }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="opening-person" style={{ '--delay': `${delay}s` }}>
      <ellipse cx="0" cy="34" rx="22" ry="14" fill={shirt} />
      <rect x="-22" y="20" width="44" height="18" rx="9" fill={shirt} />
      <circle cx="0" cy="0" r="15" fill={skin} />
      <path d="M-15 -1 a15 15 0 0 1 30 0 v-3 a15 12 0 0 0 -30 0z" fill={hair} />
      <circle cx="-5" cy="1" r="1.6" fill="#1e2b3d" />
      <circle cx="5" cy="1" r="1.6" fill="#1e2b3d" />
      <path d="M-4 7 q4 3 8 0" stroke="#1e2b3d" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}

export function OpeningScreen({ name }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setLine((current) => (current + 1) % OPENING_LINES.length), 1400);
    return () => window.clearInterval(timer);
  }, []);
  const firstName = String(name || '').trim().split(/\s+/)[0];
  return (
    <div className="opening-screen" role="status" aria-live="polite">
      <div className="opening-art" aria-hidden="true">
        <svg viewBox="-20 -20 260 270" width="280" height="290">
          <circle className="opening-ring opening-ring-a" cx="110" cy="118" r="78" />
          <circle className="opening-ring opening-ring-b" cx="110" cy="118" r="104" />
          {OPENING_PEOPLE.map((person, index) => <OpeningPerson key={index} {...person} delay={index * 0.35} />)}
          <g transform="translate(110 118)">
            <rect x="-26" y="-26" width="52" height="52" rx="14" fill="#176bba" />
            <circle cx="0" cy="0" r="13" stroke="white" strokeWidth="2.4" fill="none" />
            <path d="M-13 0h26M0 -13c-5 4-5 22 0 26M0 -13c5 4 5 22 0 26" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <div className="opening-copy">
        <span className="eyebrow">Vocivo</span>
        <h1>{firstName ? `Welcome back, ${firstName}.` : 'Your business line, wherever you are.'}</h1>
        <p key={line} className="opening-line">{OPENING_LINES[line]}<span className="opening-dots"><i /><i /><i /></span></p>
      </div>
    </div>
  );
}
