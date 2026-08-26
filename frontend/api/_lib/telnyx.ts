import { requiredEnv } from './http.js';

export class TelnyxApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'TelnyxApiError';
    this.status = status;
    this.code = code;
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
    let message = 'Telnyx could not complete this request.';
    let code: string | undefined;
    try {
      const payload = JSON.parse(detail);
      message = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || message;
      code = payload?.errors?.[0]?.code ? String(payload.errors[0].code) : undefined;
    } catch { /* Telnyx returned a non-JSON error. */ }
    if (code !== '90018') console.error(`Telnyx request failed ${response.status}: ${detail}`);
    throw new TelnyxApiError(response.status, message, code);
  }
  return response;
}
