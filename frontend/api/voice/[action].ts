import type { VercelRequest, VercelResponse } from '@vercel/node';
import conferences from '../_lib/routes/voice-conferences.js';
import settings from '../_lib/routes/voice-settings.js';
import webhook from '../_lib/routes/voice-webhook.js';
import directory from '../_lib/routes/voice-directory.js';
import transfer from '../_lib/routes/voice-transfer.js';
import video from '../_lib/routes/voice-video.js';
import voicemails from '../_lib/routes/voice-voicemails.js';
import merge from '../_lib/routes/voice-merge.js';
import status from '../_lib/routes/voice-status.js';
import route from '../_lib/routes/voice-route.js';
import history from '../_lib/routes/voice-history.js';
import cancel from '../_lib/routes/voice-cancel.js';
import devices from '../_lib/routes/voice-devices.js';
import config from '../_lib/routes/voice-config.js';
import pbxDirectory from '../_lib/routes/pbx-directory-snapshot.js';
import pbxEvents from '../_lib/routes/pbx-events.js';
import pbxDevices from '../_lib/routes/pbx-device-resolver.js';

const routes = { conferences, settings, webhook, directory, transfer, video, voicemails, merge, status, route, history, cancel, devices, config, 'pbx-directory': pbxDirectory, 'pbx-events': pbxEvents, 'pbx-devices': pbxDevices } as const;

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const route = action && routes[action as keyof typeof routes];
  return route ? route(req, res) : res.status(404).json({ error: 'Not found' });
}
