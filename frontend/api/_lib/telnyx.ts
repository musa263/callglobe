import { requiredEnv } from './http.js';

export class TelnyxApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TelnyxApiError';
    this.status = status;
  }
}

export async function telnyx(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv('TELNYX_API_KEY')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`Telnyx request failed ${response.status}: ${detail}`);
    let message = 'Telnyx could not complete this request.';
    try {
      const payload = JSON.parse(detail);
      message = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || message;
    } catch { /* Telnyx returned a non-JSON error. */ }
    throw new TelnyxApiError(response.status, message);
  }
  return response;
}
