import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { deleteWebPushSubscription, saveWebPushSubscription, webPushSubscriptionId } from '../web-push-store.js';

function clean(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\r\n]/g, '').trim().slice(0, maximum) : '';
}

function validEndpoint(value: string) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  try {
    const session = await requireSession(req);
    if (!session.organizationId || !session.extensionId) return res.status(403).json({ error: 'A calling extension is required.' });
    if (req.method === 'GET') {
      const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
      if (!publicKey) return res.status(503).json({ error: 'Web push is not configured.' });
      return res.status(200).json({ publicKey });
    }
    const endpoint = clean(req.body?.endpoint, 2048);
    if (!validEndpoint(endpoint)) return res.status(400).json({ error: 'A valid HTTPS push endpoint is required.' });
    const id = webPushSubscriptionId(endpoint);
    if (req.method === 'DELETE') {
      await deleteWebPushSubscription({ id, organizationId: session.organizationId, extensionId: session.extensionId });
      return res.status(204).end();
    }
    const p256dh = clean(req.body?.keys?.p256dh, 512);
    const auth = clean(req.body?.keys?.auth, 256);
    if (p256dh.length < 32 || auth.length < 8) return res.status(400).json({ error: 'The browser push keys are invalid.' });
    await saveWebPushSubscription({
      id,
      organizationId: session.organizationId,
      extensionId: session.extensionId,
      endpoint,
      expirationTime: Number.isFinite(Number(req.body?.expirationTime)) ? Number(req.body.expirationTime) : null,
      keys: { p256dh, auth },
      userAgent: clean(req.headers['user-agent'], 300) || undefined,
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({ registered: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
