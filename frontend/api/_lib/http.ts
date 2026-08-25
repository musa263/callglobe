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

export function publicError(error: unknown) {
  console.error(error);
  return error instanceof Error && error.message.startsWith('Missing server configuration:')
    ? error.message
    : 'The service is temporarily unavailable.';
}
