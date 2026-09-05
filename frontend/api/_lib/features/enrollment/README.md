# Enrollment

`routes/admin-enrollments.ts` creates authorized enrollment invitations;
`routes/auth-enroll.ts` validates and completes enrollment. Session/enrollment
signing lives in the auth feature. `enrollment-store.ts::consumeEnrollment`
provides the one-use replay boundary. Do not accept a second redemption or infer
company ownership from a user-supplied invitation field.

The browser entry is `src/features/enrollment/main.jsx`. Run frontend tests and
API typecheck; test expired/already-used links as well as the successful path.
