import { readExtensionCredential, readExtensionDirectory, updateExtensionDirectory } from './extension-store.js';
import type { ExtensionUser } from './pbx.js';

const dependencies = { readExtensionCredential, readExtensionDirectory, updateExtensionDirectory };

/** Complete a legacy identity migration without restoring deleted users or stale tenant metadata. */
export function createCurrentExtensionReader(deps = dependencies) {
  return async (id: string): Promise<ExtensionUser | null> => {
    const current = (await deps.readExtensionDirectory())?.find((item) => item.id === id);
    if (!current || current.sipProvider) return current || null;
    const stored = await deps.readExtensionCredential(id);
    if (!stored || stored.provider !== 'telnyx' || !stored.sipUsername
      || stored.extension.id !== current.id || stored.extension.organizationId !== current.organizationId
      || stored.extension.extension !== current.extension || stored.extension.sipUsername !== stored.sipUsername) return null;

    const directory = await deps.updateExtensionDirectory((latest) => latest.map((item) => {
      if (item.id !== id || item.sipProvider || item.organizationId !== current.organizationId
        || item.extension !== current.extension || item.sipUsername !== current.sipUsername) return item;
      // Only migrate identity fields. Status, role and other live administrative changes win.
      return { ...item, sipUsername: stored.sipUsername, sipProvider: 'telnyx' };
    }));
    return directory.find((item) => item.id === id) || null;
  };
}

export const readCurrentExtension = createCurrentExtensionReader();
