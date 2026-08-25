import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { readUserProfile } from '../profile-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireSession(req);
    const users = await Promise.all((await listExtensions()).filter((item) => item.status === 'active').map(async ({ id, extension, name, department, role, sipUsername }) => {
      const profile = await readUserProfile(`vocivo-extension:${id}`);
      return { id, extension, name: profile?.fullName || name, department: profile?.department || department, role, sipUsername, photoUrl: profile?.photoUrl, jobTitle: profile?.jobTitle };
    }));
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({ users });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
