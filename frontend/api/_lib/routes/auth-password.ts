import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { changePassword } from '../number-config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await requireOwner(req);
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) return res.status(400).json({ error: 'Use at least 10 characters with upper and lowercase letters and a number.' });
    if (!await changePassword(currentPassword, newPassword)) return res.status(400).json({ error: 'Current password is incorrect.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
