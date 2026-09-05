import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, requiredEnv } from '../../../shared/http.js';
import { get, put } from '../../../shared/object-store.js';
import { normalizedPromptText, verifyPromptSignature } from '../sip-dialplan.js';
import { telnyx } from '../../../shared/telnyx.js';
import { carrierFallbackVoice, defaultVocivoVoice, promptVoice, renderVocivoPrompt } from '../../ai/voice-catalog.js';

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

/** How long this function may spend rendering before the edge gives up on us. */
const renderBudgetMs = 24_000;

async function fetchVocivoPrompt(text: string, voice: string, timeoutMs: number) {
  const started = Date.now();
  const vocivoUrl = await renderVocivoPrompt(text, voice, timeoutMs);
  if (!vocivoUrl) return null;
  const remaining = Math.max(2000, timeoutMs - (Date.now() - started));
  const response = await fetch(vocivoUrl, { signal: AbortSignal.timeout(remaining) });
  if (!response.ok) {
    console.error('Vocivo TTS prompt fetch failed.', response.status, voice);
    return null;
  }
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'audio/wav' };
}

export class PromptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptUnavailableError';
  }
}

/**
 * The tenant's own voice first; Vocivo's default voice if the engine cannot
 * speak that one (a language this deployment lacks, say).
 *
 * A wav request is never answered with the carrier's mp3: FreeSWITCH names
 * the cached file after the URL, opens an mp3 as a wav, fails, and the caller
 * hears nothing — while the 200 made it look as though a prompt was served.
 * A 503 is honest: the edge logs it, skips the prompt, and the dialplan's
 * no-input path connects the caller anyway. The carrier is the voice only
 * when the dialplan asked for mp3, which it does when no engine is configured.
 */
async function synthesize(text: string, voice: string, format: 'wav' | 'mp3'): Promise<{ audio: Buffer; contentType: string }> {
  const preferred = promptVoice(voice);
  const started = Date.now();
  if (format === 'wav') {
    const own = await fetchVocivoPrompt(text, preferred, Math.round(renderBudgetMs * 0.6));
    if (own) return own;
    const remaining = renderBudgetMs - (Date.now() - started);
    const fallback = preferred !== defaultVocivoVoice && remaining > 3000 ? await fetchVocivoPrompt(text, defaultVocivoVoice, remaining) : null;
    if (fallback) return fallback;
    throw new PromptUnavailableError('The Vocivo voice engine could not render this prompt in time.');
  }
  const own = await fetchVocivoPrompt(text, preferred, Math.round(renderBudgetMs * 0.5));
  if (own) return own;
  console.error('Vocivo TTS could not render an mp3 prompt; using the carrier voice.');
  const response = await telnyx('/text-to-speech/speech', {
    method: 'POST',
    body: JSON.stringify({ text, voice: carrierFallbackVoice(voice), output_type: 'binary_output' }),
  });
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'audio/mpeg' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
  try {
    // Normalised the same way the URL was built, so the signature agrees
    // whatever whitespace the tenant's greeting carries.
    const text = normalizedPromptText(query(req, 'text'));
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
    if (error instanceof PromptUnavailableError) {
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: error.message });
    }
    return res.status(500).json({ error: publicError(error) });
  }
}
