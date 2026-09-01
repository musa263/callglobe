import * as SecureStore from 'expo-secure-store';

const baseUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://vocivo.vercel.app').replace(/\/$/, '');
const tokenKey = 'vocivo.session';
let cachedToken: string | null | undefined;
let tokenRequest: Promise<string | null> | null = null;

export const isApiConfigured = Boolean(baseUrl);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // A keychain read failure must not fail the request outright; treat it like a
  // missing token so the server response drives the retry and error handling.
  const token = await getSessionToken().catch(() => null);
  const method = String(init.method || 'GET').toUpperCase();
  const retryable = method === 'GET' || ['/api/auth/login', '/api/auth/enroll'].includes(path);
  const attempts = ['/api/auth/login', '/api/auth/enroll'].includes(path) ? 3 : retryable ? 2 : 1;
  const timeoutMs = path.startsWith('/api/voice/status') ? 5_000 : 10_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      const temporary = [429, 500, 502, 503, 504].includes(response.status);
      if (!response.ok && retryable && temporary && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        const failure = new Error(body?.error || 'The Vocivo service is unavailable.') as Error & { status?: number };
        failure.status = response.status;
        throw failure;
      }
      return body as T;
    } catch (error) {
      lastError = error;
      const transportError = error instanceof Error && ['AbortError', 'TypeError'].includes(error.name);
      if (!retryable || attempt === attempts - 1 || !transportError) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error('Vocivo could not reach the server. Check your connection and try again.');
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('The Vocivo service is unavailable.');
}

async function getSessionToken() {
  if (cachedToken !== undefined) return cachedToken;
  tokenRequest ||= SecureStore.getItemAsync(tokenKey).then((token) => {
    cachedToken = token;
    return token;
  }).finally(() => { tokenRequest = null; });
  return tokenRequest;
}

async function saveSessionToken(token: string) {
  cachedToken = token;
  await SecureStore.setItemAsync(tokenKey, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

async function clearSessionToken() {
  cachedToken = null;
  await SecureStore.deleteItemAsync(tokenKey);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  audioSource: async (path: string) => {
    const token = await getSessionToken();
    return { uri: `${baseUrl}${path}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
  },
  getSessionToken,
  saveSessionToken,
  clearSessionToken,
};
