const SESSION_KEY = 'vocivo.session';

export function getStoredSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

export function storeSession(session) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
export function clearSession() { localStorage.removeItem(SESSION_KEY); }

export async function api(path, options = {}) {
  const { auth = true, body, headers, ...fetchOptions } = options;
  const session = getStoredSession();
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const retryable = method === 'GET' || ['/api/auth/login', '/api/auth/enroll'].includes(path);
  const attempts = path.startsWith('/api/voice/status') ? 1 : ['/api/auth/login', '/api/auth/enroll'].includes(path) ? 3 : retryable ? 2 : 1;
  const timeoutMs = path.startsWith('/api/voice/status') ? 5000 : 10000;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(auth && session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      const temporary = [429, 500, 502, 503, 504].includes(response.status);
      if (!response.ok && retryable && temporary && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        const requestError = new Error(payload.error || 'The request could not be completed.');
        requestError.status = response.status;
        throw requestError;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (!retryable || attempt === attempts - 1 || (error instanceof Error && !['AbortError', 'TypeError'].includes(error.name))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('The request could not be completed.');
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
