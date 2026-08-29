import type { VercelRequest, VercelResponse } from '@vercel/node';
import background from '../_lib/routes/admin-background.js';
import extensions from '../_lib/routes/admin-extensions.js';
import overview from '../_lib/routes/admin-overview.js';
import trunks from '../_lib/routes/admin-trunks.js';
import enrollments from '../_lib/routes/admin-enrollments.js';
import pbx from '../_lib/routes/admin-pbx.js';
import ai from '../_lib/routes/admin-ai.js';
import events from '../_lib/routes/admin-events.js';
import numbers from '../_lib/routes/admin-numbers.js';
import voices from '../_lib/routes/admin-voices.js';
import apiKeys from '../_lib/routes/admin-api-keys.js';
import saas from '../_lib/routes/admin-saas.js';
import wallets from '../_lib/routes/admin-wallets.js';

const routes = { background, extensions, overview, trunks, enrollments, pbx, ai, events, numbers, voices, saas, wallets, 'api-keys': apiKeys } as const;

export default function handler(req: VercelRequest, res: VercelResponse) {
  const resource = Array.isArray(req.query.resource) ? req.query.resource[0] : req.query.resource;
  const route = resource && routes[resource as keyof typeof routes];
  return route ? route(req, res) : res.status(404).json({ error: 'Not found' });
}
