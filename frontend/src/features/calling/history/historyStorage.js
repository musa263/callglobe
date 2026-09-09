
export function historyStorageKey(userId) {
  return userId ? `vocivo.history.${userId}` : '';
}

export function readHistory(userId) {
  const key = historyStorageKey(userId);
  if (!key) return [];
  try {
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && typeof item.id === 'string' && typeof item.number === 'string'
      && ['incoming', 'outgoing'].includes(item.direction) && Number.isFinite(Date.parse(item.date))).slice(0, 100);
  } catch { return []; }
}

export function writeHistory(userId, items) {
  const key = historyStorageKey(userId);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(items));
  localStorage.removeItem('vocivo.history');
}
