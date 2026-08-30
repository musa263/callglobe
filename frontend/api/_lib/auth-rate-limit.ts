import { createHmac } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { requiredEnv } from './http.js';
import { transactObjectGroup } from './object-store.js';

type RateBucket = {
  failures: number;
  blockedUntil: number;
  lastAttemptAt: string;
};

export type LoginRateLimit = {
  blocked: boolean;
  retryAfterSeconds: number;
  accountHash: string;
  ipHash: string;
};

function identifier(kind: 'account' | 'ip', value: string) {
  return createHmac('sha256', `${requiredEnv('AUTH_SECRET')}:auth-rate-limit:${kind}`)
    .update(value)
    .digest('hex');
}

function pathname(kind: 'account' | 'ip', hash: string) {
  return `vocivo/security/login-rate/${kind}-${hash}.json`;
}

function readBucket(body?: Buffer): RateBucket {
  if (!body) return { failures: 0, blockedUntil: 0, lastAttemptAt: '' };
  try {
    const value = JSON.parse(body.toString('utf8')) as Partial<RateBucket>;
    return {
      failures: Number.isInteger(value.failures) && Number(value.failures) > 0 ? Number(value.failures) : 0,
      blockedUntil: Number.isFinite(value.blockedUntil) ? Number(value.blockedUntil) : 0,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : '',
    };
  } catch {
    return { failures: 0, blockedUntil: 0, lastAttemptAt: '' };
  }
}

function headersValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function requestIp(req: VercelRequest) {
  const forwarded = headersValue(req.headers['x-vercel-forwarded-for'])
    || headersValue(req.headers['x-forwarded-for'])
    || headersValue(req.headers['x-real-ip'])
    || req.socket?.remoteAddress
    || 'unknown';
  return forwarded.split(',')[0].trim().slice(0, 100) || 'unknown';
}

function context(email: string, ip: string) {
  const accountHash = identifier('account', email.trim().toLowerCase() || 'missing');
  const ipHash = identifier('ip', ip || 'unknown');
  const accountPath = pathname('account', accountHash);
  const ipPath = pathname('ip', ipHash);
  return { accountHash, ipHash, accountPath, ipPath, paths: [accountPath, ipPath] };
}

function retryAfter(buckets: RateBucket[]) {
  return Math.max(0, ...buckets.map((bucket) => Math.ceil((bucket.blockedUntil - Date.now()) / 1000)));
}

export async function checkLoginRateLimit(email: string, ip: string): Promise<LoginRateLimit> {
  const value = context(email, ip);
  return transactObjectGroup(`auth-login-check:${value.accountHash}:${value.ipHash}`, value.paths, (objects) => {
    const seconds = retryAfter(value.paths.map((path) => readBucket(objects.get(path)?.body)));
    return { result: { blocked: seconds > 0, retryAfterSeconds: seconds, accountHash: value.accountHash, ipHash: value.ipHash } };
  });
}

function nextBucket(current: RateBucket, threshold: number) {
  const failures = current.failures + 1;
  const exponent = Math.max(0, failures - threshold);
  const delaySeconds = failures >= threshold ? Math.min(3600, 15 * (2 ** exponent)) : 0;
  return {
    failures,
    blockedUntil: delaySeconds ? Date.now() + delaySeconds * 1000 : 0,
    lastAttemptAt: new Date().toISOString(),
  };
}

export async function recordLoginFailure(email: string, ip: string): Promise<LoginRateLimit> {
  const value = context(email, ip);
  return transactObjectGroup(`auth-login-failure:${value.accountHash}:${value.ipHash}`, value.paths, (objects) => {
    const account = nextBucket(readBucket(objects.get(value.accountPath)?.body), 5);
    const ipBucket = nextBucket(readBucket(objects.get(value.ipPath)?.body), 20);
    const seconds = retryAfter([account, ipBucket]);
    return {
      puts: [
        { pathname: value.accountPath, value: JSON.stringify(account), options: { access: 'private' as const, contentType: 'application/json' } },
        { pathname: value.ipPath, value: JSON.stringify(ipBucket), options: { access: 'private' as const, contentType: 'application/json' } },
      ],
      result: { blocked: seconds > 0, retryAfterSeconds: seconds, accountHash: value.accountHash, ipHash: value.ipHash },
    };
  });
}

export async function clearAccountLoginFailures(email: string, ip: string) {
  const value = context(email, ip);
  await transactObjectGroup(`auth-login-success:${value.accountHash}:${value.ipHash}`, [value.accountPath, value.ipPath], () => ({
    deletes: [value.accountPath, value.ipPath],
    result: undefined,
  }));
}
