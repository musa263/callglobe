import type { VercelRequest, VercelResponse } from '@vercel/node';
import cancel from './_lib/routes/voice-cancel.js';
import progress from './_lib/routes/voice-progress.js';
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
import aiTransfer from './_lib/routes/voice-ai-transfer.js';
import sipAuth from './_lib/routes/voice-sip-auth.js';
import sipCredentials from './_lib/routes/voice-sip-credentials.js';
import receptionist from './_lib/routes/voice-receptionist.js';
import sipInbound from './_lib/routes/voice-sip-inbound.js';
import sipWakeup from './_lib/routes/voice-sip-wakeup.js';
import sipNonce from './_lib/routes/voice-sip-nonce.js';
import sipDialplan from './_lib/routes/voice-sip-dialplan.js';
import sipPrompt from './_lib/routes/voice-sip-prompt.js';
import sipVoicemail from './_lib/routes/voice-sip-voicemail.js';

type VoiceHandler = (req: VercelRequest, res: VercelResponse) => unknown;

const routes: Readonly<Record<string, VoiceHandler>> = Object.freeze({
  cancel,
  progress,
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
  'ai-transfer': aiTransfer,
  'web-push': webPush,
  'sip-auth': sipAuth,
  'sip-credentials': sipCredentials,
  receptionist,
  'sip-inbound': sipInbound,
  'sip-wakeup': sipWakeup,
  'sip-nonce': sipNonce,
  'sip-dialplan': sipDialplan,
  'sip-prompt': sipPrompt,
  'sip-voicemail': sipVoicemail,
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
