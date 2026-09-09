
export function formatPhone(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const extension = raw.match(/^(?:Extension\s+)?(\d{2,5})$/i);
  if (extension) return extension[1];
  // Never manufacture a dialable number from digits inside a SIP credential.
  if (!/^[+\d\s().*#-]+$/.test(raw)) return 'Unknown caller';
  const clean = raw.replace(/[^+\d*#]/g, '');
  if (!clean.startsWith('+')) return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
  return `+${clean.slice(1).replace(/(\d{3})(?=\d)/g, '$1 ')}`;
}

export function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
