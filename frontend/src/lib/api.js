const SESSION_KEY = 'vocivo.session';

export function getStoredSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

export function storeSession(session) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
export function clearSession() { localStorage.removeItem(SESSION_KEY); }

export async function api(path, options = {}) {
  const { auth = true, body, headers, ...fetchOptions } = options;
  const session = getStoredSession();
  const response = await fetch(path, {
    ...fetchOptions,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

export async function apiAudio(path) {
  const session = getStoredSession();
  const response = await fetch(path, { headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {} });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'The voice preview could not be generated.');
  }
  return URL.createObjectURL(await response.blob());
}
