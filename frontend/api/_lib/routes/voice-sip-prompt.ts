import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { get, put } from '../object-store.js';
import { verifyPromptSignature } from '../sip-dialplan.js';
import { telnyx } from '../telnyx.js';
import { carrierFallbackVoice, defaultVocivoVoice, promptVoice, renderVocivoPrompt } from '../voice-catalog.js';

/**
 * Prompt audio for the SIP-edge dialplan. FreeSWITCH fetches these through
 * mod_http_cache, so URLs are deterministic (same text + voice => same URL) and
 * signed with the edge secret; the rendered audio is cached in the object store
 * so each distinct prompt is synthesised once.
 */

const maxPromptChars = 1200;

function query(req: VercelRequest, name: string) {
  const value = req.query[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '';
}

async function streamToBuffer(stream: ReadableStream<Uint8Array> | null | undefined) {
  if (!stream) return null;
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function fetchVocivoPrompt(text: string, voice: string) {
  const vocivoUrl = await renderVocivoPrompt(text, voice);
  if (!vocivoUrl) return null;
  const response = await fetch(vocivoUrl, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    console.error('Vocivo TTS prompt fetch failed.', response.status, voice);
    return null;
  }
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'audio/wav' };
}

/**
 * The tenant's own voice first; Vocivo's default voice if the engine cannot
 * speak that one (a language this deployment lacks, say); the carrier last.
 * The carrier returns mp3 while the edge asks for wav, and a wav-named file
 * holding mp3 is one FreeSWITCH cannot open — so the carrier is only ever
 * the last resort, and the format mismatch is logged when it happens.
 */
async function synthesize(text: string, voice: string, format: 'wav' | 'mp3'): Promise<{ audio: Buffer; contentType: string }> {
  const preferred = promptVoice(voice);
  const own = await fetchVocivoPrompt(text, preferred) || (preferred !== defaultVocivoVoice ? await fetchVocivoPrompt(text, defaultVocivoVoice) : null);
  if (own) return own;
  console.error(`Vocivo TTS could not render a ${format} prompt; using the carrier voice.`);
  const response = await telnyx('/text-to-speech/speech', {
    method: 'POST',
    body: JSON.stringify({ text, voice: carrierFallbackVoice(voice), output_type: 'binary_output' }),
  });
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'audio/mpeg' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
  try {
    const text = query(req, 'text').trim();
    const voice = query(req, 'voice').trim();
    const sig = query(req, 'sig').trim();
    const format = /\.wav$/i.test(query(req, 'file')) ? 'wav' : 'mp3';
    if (!text || text.length > maxPromptChars || !voice || !sig) return res.status(400).json({ error: 'A signed prompt is required.' });
    if (!verifyPromptSignature(requiredEnv('SIP_EDGE_SECRET'), text, voice, format, sig)) return res.status(403).json({ error: 'Prompt signature is invalid.' });

    const key = createHash('sha256').update(`${format}\n${voice}\n${text}`).digest('hex').slice(0, 40);
    const pathname = `vocivo/sip-prompts/${key}.${format}`;
    let audio: Buffer | null = null;
    let contentType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const cached = await get(pathname, { access: 'private' });
    if (cached) {
      audio = await streamToBuffer(cached.stream);
      contentType = cached.blob?.contentType || contentType;
    }
    if (!audio) {
      const rendered = await synthesize(text, voice, format);
      audio = rendered.audio;
      contentType = rendered.contentType;
      const expected = format === 'wav' ? /wav|x-wav|wave/i : /mpeg|mp3/i;
      if (expected.test(contentType)) {
        await put(pathname, audio, { access: 'private', contentType, allowOverwrite: true }).catch((error) => console.error('Vocivo could not cache a SIP prompt.', error));
      } else {
        // Served once, never cached: a wav-named file holding mp3 is one the
        // edge cannot play, and caching it would make the silence permanent.
        console.warn(`Vocivo SIP prompt rendered as ${contentType} but the dialplan expects ${format}; check TTS_SERVICE_URL / carrier voice output.`);
      }
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(audio.length));
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).send(audio);
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}
