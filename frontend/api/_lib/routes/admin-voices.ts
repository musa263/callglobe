import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { vocivoVoices } from '../voice-catalog.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireOwner(req);
    const serviceUrl = process.env.TTS_SERVICE_URL?.replace(/\/$/, '');
    let serviceHealthy = false;
    if (serviceUrl) {
      try {
        const response = await fetch(`${serviceUrl}/health`, { headers: process.env.TTS_SERVICE_SECRET ? { Authorization: `Bearer ${process.env.TTS_SERVICE_SECRET}` } : {}, signal: AbortSignal.timeout(2500) });
        serviceHealthy = response.ok;
      } catch { serviceHealthy = false; }
    }
    return res.status(200).json({
      provider: { id: 'vocivo-kokoro', name: 'Vocivo Voice Engine', model: 'Kokoro-82M', source: 'hexgrad/Kokoro-82M', license: 'Apache-2.0', selfHosted: true, configured: Boolean(serviceUrl), healthy: serviceHealthy },
      voices: vocivoVoices,
      carrierFallbacks: [
        { id: 'Telnyx.Bayan.Amanda', name: 'Amanda', gender: 'female', provider: 'telnyx' },
        { id: 'AWS.Polly.Joanna-Neural', name: 'Joanna neural', gender: 'female', provider: 'telnyx' },
        { id: 'AWS.Polly.Matthew-Neural', name: 'Matthew neural', gender: 'male', provider: 'telnyx' },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
