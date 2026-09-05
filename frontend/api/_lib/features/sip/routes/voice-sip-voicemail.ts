import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, readRawRequestBody, requiredEnv } from '../../../shared/http.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { verifyVoicemailUpload } from '../sip-dialplan.js';
import { storeVoicemail, storeVoicemailAudioBytes } from '../../calling/voicemail-store.js';

/**
 * Receives the voicemail recording FreeSWITCH uploads with `http_put` after the
 * caller leaves a message on the SIP edge. The URL was minted by the dialplan
 * renderer for this exact call and expires, so nothing here trusts the body
 * beyond it being a WAV file of sane size.
 */

const maxRecordingBytes = 4 * 1024 * 1024;
const wavBytesPerSecond = 16000; // 8 kHz mono 16-bit, as set by record_sample_rate in the dialplan

function query(req: VercelRequest, name: string) {
  const value = req.query[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] || '' : '';
}

export function looksLikeWav(audio: Buffer) {
  return audio.length > 44 && audio.subarray(0, 4).toString('ascii') === 'RIFF' && audio.subarray(8, 12).toString('ascii') === 'WAVE';
}

/** Approximate length of an 8 kHz mono 16-bit recording, which is what the dialplan records. */
export function wavDurationSeconds(audio: Buffer) {
  return Math.max(0, Math.round((audio.length - 44) / wavBytesPerSecond));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT' && req.method !== 'POST') return methodNotAllowed(res, ['PUT', 'POST']);
  try {
    const params = { org: query(req, 'org'), call: query(req, 'call'), from: query(req, 'from'), name: query(req, 'name'), exp: query(req, 'exp'), sig: query(req, 'sig') };
    if (!params.org || !params.call || !params.sig) return res.status(400).json({ error: 'A signed upload link is required.' });
    if (!verifyVoicemailUpload(requiredEnv('SIP_EDGE_SECRET'), params)) return res.status(403).json({ error: 'Upload link is invalid or expired.' });

    const config = await readPbxConfig();
    if (!config.organizations.some((item) => item.id === params.org)) return res.status(404).json({ error: 'Unknown organization.' });

    const audio = await readRawRequestBody(req, maxRecordingBytes);
    if (!audio || !looksLikeWav(audio)) return res.status(400).json({ error: 'Expected a WAV recording under 4 MB.' });

    const id = `sip-${params.call.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'call'}`;
    const recordingPath = await storeVoicemailAudioBytes(id, audio, 'audio/wav');
    const now = new Date().toISOString();
    await storeVoicemail({
      id,
      recordingId: id,
      callerNumber: params.from || 'Unknown caller',
      callerName: params.name || undefined,
      recordingPath,
      durationSeconds: wavDurationSeconds(audio),
      createdAt: now,
      updatedAt: now,
      organizationId: params.org,
    });
    return res.status(200).json({ stored: true, id });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}
