import { requiredEnv } from './http.js';
import { sipInboundEnabled } from './voice-provider.js';

export function telnyxPstnConnectionId() {
  return requiredEnv('TELNYX_CALL_CONTROL_APP_ID');
}

/**
 * The carrier connection a Vocivo number must sit on for inbound calls to
 * reach Vocivo: the SIP edge's IP connection once VOCIVO_SIP_INBOUND is on,
 * the Call Control application before that.
 *
 * Null means "leave the number's connection alone": the edge is answering
 * inbound but TELNYX_SIP_CONNECTION_ID has not been set, and moving numbers
 * onto the Call Control application would silently undo the cut-over — which
 * is what every voice-menu save and every "Save route" used to do.
 */
export function inboundConnectionId(): string | null {
  if (sipInboundEnabled()) {
    const sipConnection = process.env.TELNYX_SIP_CONNECTION_ID?.trim() || '';
    if (!sipConnection) console.warn('VOCIVO_SIP_INBOUND is on but TELNYX_SIP_CONNECTION_ID is not set; number connections are left unchanged.');
    return sipConnection || null;
  }
  return telnyxPstnConnectionId();
}

export function telnyxPstnConnectionPath() {
  return `/call_control_applications/${encodeURIComponent(requiredEnv('TELNYX_CALL_CONTROL_APP_ID'))}`;
}

export function telnyxCredentialConnectionPath() {
  return `/credential_connections/${encodeURIComponent(requiredEnv('TELNYX_CONNECTION_ID'))}`;
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

export class TelnyxCarrierUnavailableError extends Error {
  constructor() {
    super('Vocivo calling is temporarily unavailable.');
    this.name = 'TelnyxCarrierUnavailableError';
  }
}

type CarrierHealth = {
  checkedAt: number;
  ready: boolean;
};

let carrierHealth: CarrierHealth | undefined;
const carrierHealthTtlMs = 15_000;

export function telnyxCarrierHasCredit(payload: unknown) {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : undefined;
  if (!data || typeof data !== 'object') return false;
  const balance = data as { available_credit?: string | number; balance?: string | number };
  const availableCredit = Number(balance.available_credit ?? balance.balance);
  return Number.isFinite(availableCredit) && availableCredit > 0;
}

export async function assertTelnyxVoiceReady() {
  const now = Date.now();
  if (!carrierHealth || now - carrierHealth.checkedAt >= carrierHealthTtlMs) {
    const response = await telnyx('/balance');
    const payload = await response.json();
    carrierHealth = { checkedAt: now, ready: telnyxCarrierHasCredit(payload) };
  }
  if (!carrierHealth.ready) throw new TelnyxCarrierUnavailableError();
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
      // Clear the previous attempt's response: its body has already been
      // drained, so a failed retry must not fall through to re-reading it.
      response = undefined;
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
