import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError } from '../http.js';
import { getExtensionCredentials, listExtensions } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { verifyPbxRequest } from '../pbx-internal-auth.js';
import { organizationSipDomain } from '../voice-provider.js';
import { readUserProfiles } from '../profile-store.js';

function clean(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    verifyPbxRequest(req);
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
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      schema: 'vocivo.directory.v1',
      revision: config.updatedAt,
      generatedAt: new Date().toISOString(),
      users,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: publicError(error) });
  }
}
