import { requiredEnv } from './http.js';

export function telnyxPstnConnectionId() {
  return process.env.TELNYX_PSTN_CONNECTION_ID || requiredEnv('TELNYX_CALL_CONTROL_APP_ID');
}

export function telnyxPstnConnectionPath() {
  const dedicatedConnectionId = process.env.TELNYX_PSTN_CONNECTION_ID;
  return dedicatedConnectionId
    ? `/ip_connections/${encodeURIComponent(dedicatedConnectionId)}`
    : `/credential_connections/${encodeURIComponent(requiredEnv('TELNYX_CONNECTION_ID'))}`;
}

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

function requestTimeoutMs() {
  const configured = Number(process.env.TELNYX_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.min(30_000, Math.max(250, configured)) : 7_000;
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export async function telnyx(path: string, init: RequestInit = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 2 : 1;
  let response: Response | undefined;
  let requestError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(`https://api.telnyx.com/v2${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs()),
        headers: {
          Authorization: `Bearer ${requiredEnv('TELNYX_API_KEY')}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
      if (response.ok || !retryableStatus(response.status) || attempt === attempts - 1) break;
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      requestError = error;
      if (attempt === attempts - 1) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!response) {
    const timedOut = requestError instanceof Error && ['AbortError', 'TimeoutError'].includes(requestError.name);
    throw new TelnyxApiError(504, timedOut ? 'Telnyx did not respond in time.' : 'Telnyx could not be reached.');
  }
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
