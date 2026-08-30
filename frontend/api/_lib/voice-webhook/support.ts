import { waitUntil } from '@vercel/functions';
import { publicError, requiredEnv } from '../http.js';
import type { VoicePayload } from './contracts.js';

export function callerDisplay(value: string) {
  return value.replace(/[^A-Za-z0-9 _~!.+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128) || 'Vocivo';
}

export function customHeader(payload: VoicePayload | undefined, name: string) {
  const match = payload?.custom_headers?.find((header) => (
    header.name || header.header_name || ''
  ).toLowerCase() === name.toLowerCase());
  return (match?.value || match?.header_value || '').trim();
}

export function enterpriseRingbackUrl() {
  return `${requiredEnv('VITE_APP_URL').replace(/\/+$/, '')}/audio/ringback.wav?v=enterprise-2`;
}

export function background(label: string, task: Promise<unknown>) {
  waitUntil(task.catch((error) => console.warn(`Vocivo background ${label} failed`, publicError(error))));
}

export function logWebhookFailure(operation: string, error: unknown) {
  console.warn('Vocivo voice webhook best-effort operation failed', {
    operation,
    error: publicError(error),
  });
}
