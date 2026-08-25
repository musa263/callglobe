import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readPbxConfig, savePbxConfig } from '../pbx-config-store.js';
import { listExtensions } from '../pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    await requireOwner(req);
    let config;
    if (req.method === 'PUT') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // Number routing, Business Voice and AI have dedicated endpoints. Ignoring
      // those fields here prevents a stale admin screen from undoing newer saves.
      const {
        version: _version,
        updatedAt: _updatedAt,
        numberAssignments: _numberAssignments,
        businessVoiceConfigs: _businessVoiceConfigs,
        ai: _ai,
        ...editable
      } = body;
      if (editable.callHandling) {
        const current = await readPbxConfig();
        const organizationId = typeof editable.activeOrganizationId === 'string' ? editable.activeOrganizationId : current.activeOrganizationId;
        const extensionIds = new Set((await listExtensions(organizationId)).filter((item) => item.status === 'active').map((item) => item.id));
        const groups = [...(editable.callHandling.ringGroups || []), ...(editable.callHandling.queues || [])];
        const unknownMember = groups.flatMap((item: { members?: string[] }) => item.members || []).find((id: string) => !extensionIds.has(id));
        if (unknownMember) return res.status(400).json({ error: 'A call-handling route contains a removed or inactive extension. Refresh users and choose its members again.' });
        const invalidIvrExtension = (editable.callHandling.ivrs || []).flatMap((item: { options?: Record<string, string> }) => Object.values(item.options || {}))
          .find((target: string) => target.startsWith('extension:') && !extensionIds.has(target.slice('extension:'.length)));
        if (invalidIvrExtension) return res.status(400).json({ error: 'A voice menu points to a removed or inactive extension. Refresh users and choose its destination again.' });
      }
      config = await savePbxConfig(editable);
    } else {
      config = await readPbxConfig();
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /call-handling|Ring group|Queue|Voice menu|phone number points|Office hours|office-hours|holiday|user|forwarding/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}
