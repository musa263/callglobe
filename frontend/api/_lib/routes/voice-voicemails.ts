import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { deleteVoicemail, listVoicemails, readVoicemailAudio } from '../voicemail-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'DELETE']);
  try {
    await requireSession(req);
    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id) return res.status(400).json({ error: 'Voicemail id is required.' });
      return res.status((await deleteVoicemail(id)) ? 200 : 404).json({ success: true });
    }
    if (req.query.audio === '1') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      const voicemail = (await listVoicemails()).find((item) => item.id === id);
      if (!voicemail) return res.status(404).json({ error: 'Voicemail not found.' });
      const audio = await readVoicemailAudio(voicemail.recordingPath);
      if (!audio?.stream) return res.status(404).json({ error: 'Recording not found.' });
      const chunks: Buffer[] = [];
      for await (const chunk of audio.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(Buffer.concat(chunks));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ voicemails: await listVoicemails() });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
