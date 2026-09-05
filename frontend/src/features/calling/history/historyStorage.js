
export function historyStorageKey(userId) {
  return userId ? `vocivo.history.${userId}` : '';
}

export function readHistory(userId) {
  const key = historyStorageKey(userId);
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

export function writeHistory(userId, items) {
  const key = historyStorageKey(userId);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(items));
  localStorage.removeItem('vocivo.history');
}
