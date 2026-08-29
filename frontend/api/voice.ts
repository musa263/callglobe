import type { VercelRequest, VercelResponse } from '@vercel/node';
import cancel from './_lib/routes/voice-cancel.js';
import conferences from './_lib/routes/voice-conferences.js';
import config from './_lib/routes/voice-config.js';
import devices from './_lib/routes/voice-devices.js';
import directory from './_lib/routes/voice-directory.js';
import history from './_lib/routes/voice-history.js';
import merge from './_lib/routes/voice-merge.js';
import route from './_lib/routes/voice-route.js';
import settings from './_lib/routes/voice-settings.js';
import status from './_lib/routes/voice-status.js';
import transfer from './_lib/routes/voice-transfer.js';
import video from './_lib/routes/voice-video.js';
import voicemails from './_lib/routes/voice-voicemails.js';
import webhook from './_lib/routes/voice-webhook.js';
import webPush from './_lib/routes/voice-web-push.js';

type VoiceHandler = (req: VercelRequest, res: VercelResponse) => unknown;

const routes: Readonly<Record<string, VoiceHandler>> = Object.freeze({
  cancel,
  conferences,
  config,
  devices,
  directory,
  history,
  merge,
  route,
  settings,
  status,
  transfer,
  video,
  voicemails,
  webhook,
  'web-push': webPush,
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  const resource = Array.isArray(req.query.resource)
    ? req.query.resource[0]
    : req.query.resource;
  const voiceHandler = resource ? routes[resource] : undefined;

  if (!voiceHandler) {
    return res.status(404).json({ error: 'Voice resource not found' });
  }

  return voiceHandler(req, res);
}
