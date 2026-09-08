import { SignJWT } from 'jose';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest } from '@vercel/node';
import { requireOwner, requireSession } from './auth.js';

test('owner authentication fails closed when its revocation store is unavailable', async () => {
  const previous = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_URL: process.env.POSTGRES_URL, AUTH_SECRET: process.env.AUTH_SECRET };
  // Exercise the real store failure path without opening any database connection.
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  process.env.AUTH_SECRET = 'local-test-secret-not-a-production-key';
  try {
    const token = await new SignJWT({role:'superadmin'}).setSubject('vocivo-owner').setIssuer('vocivo-vercel').setAudience('vocivo-mobile').setIssuedAt().setExpirationTime('1h').setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    const req = { headers: { authorization: `Bearer ${token}` } } as VercelRequest;
    await assert.rejects(requireOwner(req), /session verification is temporarily unavailable/);
    // A failed lookup must not cache zero and authorize the following request.
    await assert.rejects(requireSession(req), /session verification is temporarily unavailable/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
