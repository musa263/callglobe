import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { createSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readPasswordHash } from '../number-config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expectedEmail = requiredEnv('APP_ADMIN_EMAIL').trim().toLowerCase();
    const passwordHash = await readPasswordHash().catch(() => requiredEnv('APP_PASSWORD_HASH'));
    const valid = email === expectedEmail && password.length >= 8 && await bcrypt.compare(password, passwordHash);

    if (!valid) return res.status(401).json({ error: 'Email or password is incorrect.' });

    const token = await createSession(email);
    return res.status(200).json({
      token,
      profile: {
        id: 'vocivo-owner',
        email,
        full_name: process.env.APP_ADMIN_NAME || 'Vocivo Superadmin',
        currency: 'USD',
        role: 'superadmin',
        account_type: 'platform',
        organization_name: 'Vocivo',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}
