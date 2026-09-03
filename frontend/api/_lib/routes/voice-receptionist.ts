import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { parseConversation, receptionistFor } from '../receptionist.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';

/**
 * The SIP edge's two questions about Vocivo's own receptionist.
 *
 * GET  — which receptionist answers for the number that was dialled.
 * POST — what happened on a call that has just ended.
 *
 * Only the edge may ask, over the same shared secret Kamailio already uses.
 * Nothing here reaches a carrier: the conversation happened on Vocivo's own
 * droplet, in Vocivo's own speech engines.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.', enabled: false });

    if (req.method === 'GET') {
      const number = typeof req.query.number === 'string' ? req.query.number : '';
      const config = await readPbxConfig();
      const profile = await receptionistFor({
        number,
        config,
        tenantFor: (organizationId) => pbxForOrganization(config, organizationId),
        extensionsFor: (organizationId) => listExtensions(organizationId),
      });
      // 404 rather than an empty profile: the edge releases the call, which is
      // the honest outcome for a number no receptionist answers.
      if (!profile) return res.status(404).json({ enabled: false });
      return res.status(200).json(profile);
    }

    const conversation = parseConversation(req.body);
    if (!conversation) return res.status(400).json({ error: 'A conversation needs a callId.' });
    console.log('vocivo receptionist call', JSON.stringify({
      callId: conversation.callId,
      number: conversation.number,
      outcome: conversation.outcome,
      transferredTo: conversation.transferredTo,
      seconds: conversation.seconds,
    }));
    return res.status(202).json({ recorded: true });
  } catch (error) {
    return res.status(500).json({ error: publicError(error), enabled: false });
  }
}
