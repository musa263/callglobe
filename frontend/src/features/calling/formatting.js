
export function formatPhone(value) {
  if (!value) return '';
  const clean = value.replace(/[^+\d*#]/g, '');
  if (!clean.startsWith('+')) return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
  return `+${clean.slice(1).replace(/(\d{3})(?=\d)/g, '$1 ')}`;
}

export function formatDuration(seconds = 0) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
