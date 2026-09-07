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

## Owner login storage

`owner-password.ts` verifies the owner's bcrypt password using the encrypted
`vocivo/auth/owner.bin` record in the current Prisma Postgres database. Login and
password changes never call Telnyx. A missing record may use the server-only
`APP_PASSWORD_HASH` bootstrap value for a new installation. Database errors or
unreadable stored credentials fail closed; they do not revive a bootstrap hash.
Tenant account passwords remain bcrypt hashes in `vocivo_saas_admins`.

For an installation still using a legacy carrier password tag, run
`node --import tsx scripts/migrate-owner-credential.mjs --env-file /protected/env`
from `frontend` to dry-run. With migration authorization, add `--apply` to copy
and verify the same hash in encrypted storage before deploying this login code.
The import refuses to overwrite an existing different password. Deploy and
verify the new storage path, then run with `--apply --remove-legacy-tag` to
remove only the retired password tag. Preserve unrelated carrier tags.
Neither the migration nor its output contains the plaintext password.

Test with the owner-password regression suite and `bash verify.sh`. Hash equality
proves password preservation; a real signed-in browser remains a separate
acceptance check. The web uses an HttpOnly `vocivo_session` cookie, mobile uses
SecureStore, and both use the Vercel API's signed `vocivo-vercel` sessions.
