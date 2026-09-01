import type { VercelRequest, VercelResponse } from '@vercel/node';

export function allowMobile(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
