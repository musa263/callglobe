import * as SecureStore from 'expo-secure-store';

const baseUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://vocivo.vercel.app').replace(/\/$/, '');
const tokenKey = 'vocivo.session';

export const isApiConfigured = Boolean(baseUrl);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(tokenKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
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
    if (!response.ok) throw new Error(body?.error || 'The Vocivo service is unavailable.');
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Vocivo could not reach the server. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  audioSource: async (path: string) => {
    const token = await SecureStore.getItemAsync(tokenKey);
    return { uri: `${baseUrl}${path}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
  },
  getSessionToken: () => SecureStore.getItemAsync(tokenKey),
  saveSessionToken: (token: string) => SecureStore.setItemAsync(tokenKey, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clearSessionToken: () => SecureStore.deleteItemAsync(tokenKey),
};
