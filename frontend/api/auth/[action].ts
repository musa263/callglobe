import type { VercelRequest, VercelResponse } from '@vercel/node';
import login from '../_lib/routes/auth-login.js';
import password from '../_lib/routes/auth-password.js';
import session from '../_lib/routes/auth-session.js';
import enroll from '../_lib/routes/auth-enroll.js';
import profile from '../_lib/routes/auth-profile.js';
import bootstrap from '../_lib/routes/mobile-bootstrap.js';

const routes = { login, password, session, enroll, profile, bootstrap } as const;

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  // Own keys only, or 'toString' resolves an inherited function that never answers.
  const route = action && Object.hasOwn(routes, action) ? routes[action as keyof typeof routes] : undefined;
  return route ? route(req, res) : res.status(404).json({ error: 'Not found' });
}
