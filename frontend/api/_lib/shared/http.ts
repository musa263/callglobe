import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';

/**
 * Runs `task` after the response has gone out, and never lets it fail the
 * request. For work the person saving a form should not wait on — such as
 * asking the voice engine to render their new greeting.
 */
export function afterResponse(label: string, task: Promise<unknown>) {
  waitUntil(task.catch((error) => console.warn(`Vocivo background ${label} failed`, publicError(error))));
}

export function allowMobile(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vocivo-Csrf');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function methodNotAllowed(res: VercelResponse, methods: string[]) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ error: 'Method not allowed' });
}

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function writeAuthError(res: VercelResponse, error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.message === 'Unauthorized') {
    res.status(401).json({ error: 'Session expired.' });
    return true;
  }
  if (error.message === 'Password change required') {
    res.status(403).json({ error: 'Update your password before continuing.' });
    return true;
  }
  if (error.message === 'Forbidden') {
    res.status(403).json({ error: 'Administrative access is required.' });
    return true;
  }
  return false;
}

export function publicError(error: unknown) {
  console.error(error);
  return 'The service is temporarily unavailable.';
}

/**
 * Reads the raw request body. Vercel's body helper drains the stream and replays
 * it only through req.on('data'/'end'), so the event API is the reliable path;
 * bodies the helper already parsed into a Buffer are returned as-is.
 */
export function readRawRequestBody(req: VercelRequest, maximumBytes = 4 * 1024 * 1024): Promise<Buffer | null> {
  const parsed = (req as VercelRequest & { body?: unknown }).body;
  if (Buffer.isBuffer(parsed)) return Promise.resolve(parsed.length <= maximumBytes ? parsed : null);
  if (typeof (req as { on?: unknown }).on !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(chunks.length ? Buffer.concat(chunks) : null), 5000);
    req.on('data', (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > maximumBytes) return finish(null);
      chunks.push(value);
    });
    req.on('end', () => finish(chunks.length ? Buffer.concat(chunks) : null));
    req.on('error', () => finish(null));
  });
}
