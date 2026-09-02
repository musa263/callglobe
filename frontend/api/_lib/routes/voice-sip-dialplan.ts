import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { listExtensions } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { isLocalOrigination, parseXmlCurlRequest, renderSipDialplan, xmlCurlNotFound } from '../sip-dialplan.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { normalizeE164 } from '../tenancy.js';
import { sipInboundEnabled } from '../voice-provider.js';

/**
 * mod_xml_curl dialplan binding for the self-hosted SIP edge.
 *
 * FreeSWITCH POSTs the call's channel variables here at every routing step
 * (initial INVITE and each `transfer`). A "not found" document hands the call
 * back to the static dialplan on the droplet, which is also what happens while
 * VOCIVO_SIP_INBOUND is off, so enabling this route changes nothing until the
 * operator flips that flag on both sides.
 */

function sendXml(res: VercelResponse, xml: string) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(xml);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.' });
  try {
    const request = parseXmlCurlRequest(req.body);
    if (request.section !== 'dialplan') return sendXml(res, xmlCurlNotFound());
    if (!sipInboundEnabled() || isLocalOrigination(request)) return sendXml(res, xmlCurlNotFound());

    const config = await readPbxConfig();
    let organizationId: string;
    let did: string;
    if (request.stage) {
      organizationId = request.organizationId;
      did = normalizeE164(request.did);
      if (!organizationId || !config.organizations.some((item) => item.id === organizationId)) return sendXml(res, xmlCurlNotFound());
    } else {
      did = normalizeE164(request.destinationNumber);
      const assignment = config.numberAssignments[did];
      if (!assignment?.organizationId) return sendXml(res, xmlCurlNotFound());
      organizationId = assignment.organizationId;
    }
    const organization = config.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status !== 'active') return sendXml(res, xmlCurlNotFound());

    const [business, extensions] = await Promise.all([
      readBusinessVoiceConfig(organizationId),
      listExtensions(organizationId),
    ]);
    const xml = renderSipDialplan({
      request,
      organizationId,
      did,
      pbx: pbxForOrganization(config, organizationId),
      business,
      extensions,
      apiUrl: requiredEnv('VITE_APP_URL'),
      secret: requiredEnv('SIP_EDGE_SECRET'),
      promptFormat: process.env.TTS_SERVICE_URL?.trim() ? 'wav' : 'mp3',
      recordingsDir: process.env.VOCIVO_SIP_RECORDINGS_DIR?.trim() || '/var/lib/vocivo/recordings',
      trunkGateway: 'telnyx',
      now: new Date(),
    });
    return sendXml(res, xml);
  } catch (error) {
    // A non-200 makes mod_xml_curl fall through to the static dialplan, which
    // still answers with the "inbound stays on Call Control" hold behaviour.
    return res.status(500).json({ error: publicError(error) });
  }
}
