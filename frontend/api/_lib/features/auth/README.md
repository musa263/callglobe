# Authentication

`routes/auth-login.ts` verifies passwords after IP/account throttling;
`auth.ts` creates signed sessions and exposes `requireSession`, `requireAdmin`
and `requireOwner` as the three authorization entry points. Do not substitute
session presence for role checks. `admin-account-access.ts` controls who may
grant administrative roles and edit other accounts.

Password/profile/session HTTP operations are in `routes/`. The owner credential
store, profile store and session revocation helpers own persistence. Mobile
bootstrap aggregates permitted data after authentication; it is not SIP startup.
Colocated tests cover revocation, role boundaries and escalation. Run frontend
`npm test` and `npm run check:api` after changes.
