import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { deleteVoicemail, listVoicemails, readVoicemailAudio } from '../voicemail-store.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { sessionOrganizationId } from '../tenancy.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'DELETE']);
  try {
    const session = await requireSession(req);
    const organizationId = sessionOrganizationId(session, await readPbxConfig());
    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id) return res.status(400).json({ error: 'Voicemail id is required.' });
      if (!await deleteVoicemail(id, organizationId)) return res.status(404).json({ error: 'Voicemail not found.' });
      return res.status(200).json({ success: true });
    }
    if (req.query.audio === '1') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      const voicemail = (await listVoicemails(organizationId)).find((item) => item.id === id);
      if (!voicemail) return res.status(404).json({ error: 'Voicemail not found.' });
      const audio = await readVoicemailAudio(voicemail.recordingPath);
      if (!audio?.stream) return res.status(404).json({ error: 'Recording not found.' });
      const chunks: Buffer[] = [];
      for await (const chunk of audio.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      res.setHeader('Content-Type', audio.blob?.contentType || 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(Buffer.concat(chunks));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ voicemails: await listVoicemails(organizationId) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}
