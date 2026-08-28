import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError } from '../http.js';
import { getExtensionCredentials, listExtensions } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { verifyPbxRequest } from '../pbx-internal-auth.js';
import { organizationSipDomain } from '../voice-provider.js';
import { readUserProfiles } from '../profile-store.js';

function clean(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyPbxRequest(req);
    if (req.body?.schema !== 'vocivo.directory-query.v1') return res.status(400).json({ error: 'Invalid directory query.' });
    const [config, extensions] = await Promise.all([readPbxConfig(), listExtensions()]);
    const active = extensions.filter((item) => item.status === 'active');
    if (active.length > 10_000) throw new Error('The PBX directory exceeds the supported snapshot size.');
    const profiles = await readUserProfiles(active.map((item) => `vocivo-extension:${item.id}`));
    const users = await Promise.all(active.map(async (extension) => {
      const credential = await getExtensionCredentials(extension.id);
      const organization = config.organizations.find((item) => item.id === extension.organizationId);
      const pbxProfile = config.userProfiles[extension.id];
      const userProfile = profiles.get(`vocivo-extension:${extension.id}`);
      return {
        id: extension.id,
        extension: extension.extension,
        username: credential.sipUsername,
        password: credential.sipPassword,
        domain: organizationSipDomain(config, extension.organizationId),
        name: clean(userProfile?.fullName || extension.name, 80),
        organizationId: extension.organizationId,
        organizationName: clean(organization?.name, 100),
        voicemailPassword: extension.extension,
        photoUrl: /^https:\/\//i.test(userProfile?.photoUrl || '') ? clean(userProfile?.photoUrl, 1000) : '',
        outboundCallerId: clean(pbxProfile?.outboundCallerId || config.company.defaultCallerId, 24).replace(/[\s()-]/g, ''),
      };
    }));
    const userByExtensionId = new Map(users.map((user) => [user.id, user]));
    const extensionIdsForTarget = (organizationId: string, type: string, id?: string) => {
      if (type === 'main') return active.filter((extension) => extension.organizationId === organizationId).map((extension) => extension.id);
      if (type === 'extension') return id ? [id] : [];
      const tenant = pbxForOrganization(config, organizationId);
      if (type === 'ring_group') return tenant.callHandling.ringGroups.find((item) => item.id === id)?.members || [];
      if (type === 'queue') return tenant.callHandling.queues.find((item) => item.id === id)?.members || [];
      if (type === 'ivr') {
        const ivr = tenant.callHandling.ivrs.find((item) => item.id === id);
        const ids = new Set<string>();
        for (const target of Object.values(ivr?.options || {})) {
          const [targetType, targetId] = target.split(':', 2);
          for (const extensionId of extensionIdsForTarget(organizationId, targetType, targetId)) ids.add(extensionId);
        }
        return [...ids];
      }
      return [];
    };
    const inboundRoutes = Object.entries(config.numberAssignments).flatMap(([did, assignment]) => {
      const organization = config.organizations.find((item) => item.id === assignment.organizationId && item.status === 'active');
      const normalizedDid = did.replace(/[\s()-]/g, '');
      if (!organization || !/^\+[1-9]\d{6,14}$/.test(normalizedDid)) return [];
      const destinationType = assignment.destinationType || 'main';
      const targets = [...new Set(extensionIdsForTarget(organization.id, destinationType, assignment.destinationId))]
        .flatMap((extensionId) => {
          const user = userByExtensionId.get(extensionId);
          return user?.organizationId === organization.id
            ? [{ extensionId: user.id, extension: user.extension, username: user.username, domain: user.domain }]
            : [];
        });
      return [{
        did: normalizedDid,
        organizationId: organization.id,
        organizationName: clean(organization.name, 100),
        destinationType,
        destinationId: assignment.destinationId || '',
        targets,
      }];
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      schema: 'vocivo.directory.v1',
      revision: config.updatedAt,
      generatedAt: new Date().toISOString(),
      users,
      inboundRoutes,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: publicError(error) });
  }
}
