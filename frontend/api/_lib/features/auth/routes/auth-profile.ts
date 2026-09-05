import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { readUserProfile, saveProfilePhoto, saveUserProfile, type StoredUserProfile } from '../profile-store.js';
import { VOCIVO_SUPERADMIN_NAME } from '../../organizations/platform-identity.js';

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').trim().slice(0, max) : '';
}

function baseProfile(session: Awaited<ReturnType<typeof requireSession>>): StoredUserProfile {
  const owner = session.sub === 'vocivo-owner';
  return {
    id: session.sub || 'vocivo-user',
    fullName: owner ? process.env.APP_ADMIN_NAME || VOCIVO_SUPERADMIN_NAME : session.name || `Extension ${session.extension || ''}`,
    email: session.email || '',
    jobTitle: owner ? 'Platform superadmin' : '',
    department: '',
    mobile: '',
    location: '',
    bio: '',
    updatedAt: new Date(0).toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const session = await requireSession(req);
    const base = baseProfile(session);
    const existing = await readUserProfile(base.id);
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ profile: { ...base, ...existing, id: base.id, email: base.email || existing?.email || '' } });
    }
    const photo = req.body?.photo;
    const photoUrl = photo?.base64 && photo?.mimeType
      ? await saveProfilePhoto(base.id, { base64: String(photo.base64), mimeType: String(photo.mimeType) })
      : existing?.photoUrl;
    const profile: StoredUserProfile = {
      id: base.id,
      fullName: clean(req.body?.fullName, 80) || existing?.fullName || base.fullName,
      email: base.email || existing?.email || '',
      jobTitle: clean(req.body?.jobTitle, 80),
      department: clean(req.body?.department, 60),
      mobile: clean(req.body?.mobile, 30),
      location: clean(req.body?.location, 80),
      bio: clean(req.body?.bio, 240),
      photoUrl,
      updatedAt: new Date().toISOString(),
    };
    return res.status(200).json({ profile: await saveUserProfile(profile) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /photo|JPEG|PNG|WebP|2.5 MB/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}
