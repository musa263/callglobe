import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { vocivoVoices, voiceDefinition } from '../voice-catalog.js';
import { telnyx } from '../telnyx.js';

const carrierFallbacks = [
  { id: 'Telnyx.Bayan.Amanda', name: 'Amanda', gender: 'female', provider: 'telnyx' },
  { id: 'AWS.Polly.Joanna-Neural', name: 'Joanna neural', gender: 'female', provider: 'telnyx' },
  { id: 'AWS.Polly.Matthew-Neural', name: 'Matthew neural', gender: 'male', provider: 'telnyx' },
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireAdmin(req);
    if (req.query.preview === '1') {
      const voice = typeof req.query.voice === 'string' ? req.query.voice.slice(0, 120) : '';
      const definition = voiceDefinition(voice);
      const allowedCarrier = carrierFallbacks.some((item) => item.id === voice);
      if (!definition && !allowedCarrier) return res.status(400).json({ error: 'Choose a supported voice.' });
      const previewVoice = definition ? `Telnyx.KokoroTTS.${definition.sourceVoice}` : voice;
      const response = await telnyx('/text-to-speech/speech', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello. This is your Vocivo voice preview. Connect. Talk. Anywhere.', voice: previewVoice, output_type: 'binary_output' }),
      });
      const audio = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).send(audio);
    }
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
      carrierFallbacks,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
