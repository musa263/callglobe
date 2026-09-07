import bcrypt from 'bcryptjs';
import { requiredEnv } from '../../shared/http.js';
import { readStoredOwnerPasswordHash, writeOwnerPasswordHash } from './owner-credential-store.js';

type Dependencies = {
  readHash: () => Promise<string | null>;
  writeHash: (hash: string) => Promise<void>;
  bootstrapHash: () => string;
};

/** Owner authentication belongs to the control plane and never calls the carrier. */
export function createOwnerPasswordService(deps: Dependencies = {
  readHash: readStoredOwnerPasswordHash,
  writeHash: writeOwnerPasswordHash,
  bootstrapHash: () => requiredEnv('APP_PASSWORD_HASH'),
}) {
  const readPasswordHash = async () => {
    // Only a genuinely absent record may use a new installation's bootstrap
    // hash. Database outages and corrupt credentials must not revive old access.
    const hash = await deps.readHash() ?? deps.bootstrapHash();
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error('Owner credential configuration is invalid.');
    return hash;
  };
  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!await bcrypt.compare(currentPassword, await readPasswordHash())) return false;
    await deps.writeHash(await bcrypt.hash(newPassword, 12));
    return true;
  };
  return { readPasswordHash, changePassword };
}

export const { readPasswordHash, changePassword } = createOwnerPasswordService();
