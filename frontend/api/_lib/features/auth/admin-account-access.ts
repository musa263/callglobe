/**
 * Who inside a company may act on whose account.
 *
 * Two separate questions, and conflating them is what let an administrator
 * take the owner's login: "may this person hand out administrator access?" is
 * about the role a request is asking for, and "may this person touch that
 * account at all?" is about the role the account already holds. A PATCH that
 * named no role answered the first question vacuously and was never asked the
 * second, so a company_admin could set a new password on the company_owner's
 * extension and sign in as them.
 */

const adminRoles = ['company_owner', 'company_admin'];

export type AdminActor = {
  superadmin: boolean;
  /** The session's role: company_owner, company_admin, or something without administration. */
  role?: string;
  /** The extension this session signs in as, when it has one. */
  extensionId?: string;
};

export function isAdminRole(role: unknown) {
  return typeof role === 'string' && adminRoles.includes(role);
}

/** May this person give an account administrator access, or keep it there? */
export function mayGrantAdminAccess(actor: AdminActor, requestedRole: unknown) {
  if (actor.superadmin) return true;
  if (!isAdminRole(requestedRole)) return true;
  return actor.role === 'company_owner';
}

/**
 * May this person change or remove this account?
 *
 * Ordinary users are any administrator's to manage. An account that already
 * holds administrator access belongs to the company owner — and to the person
 * whose account it is, so an administrator can still edit their own.
 */
export function mayAdministerAccount(actor: AdminActor, target: { id: string; role: string }) {
  if (actor.superadmin) return true;
  if (!isAdminRole(target.role)) return true;
  return actor.role === 'company_owner' || (Boolean(actor.extensionId) && actor.extensionId === target.id);
}
