# Mobile Authentication

`AuthContext` restores/changes the signed-in account and synchronizes native
authentication gates. `screens/AuthScreen` renders credential/enrollment input.
`shared/api` owns HTTP/session persistence. Calling bootstrap is separately owned
by calling/runtime so a native wake need not wait for visual screen loading.

Sign-out must revoke calling/push access, not only navigate away. Test session
restoration, rejection and logout during pending registration using `npm test`;
run typecheck after changing context contracts.

Returning accounts can render from `sessionSnapshot.ts` while `/auth/session`
revalidates in the background. The snapshot is stored in SecureStore, bound to
the exact session token, limited to 24 hours, and rejected when the token is
expired or within 30 seconds of expiry. This is presentation caching, not
authorization: protected APIs still validate the session, and balances are not
restored from the snapshot. A 401/403 clears the cached account; temporary network
failure keeps its presentation available. First login still requires validation.

Account epochs discard late session/bootstrap responses after logout. Owned
history timers are cancelled at teardown. Native sign-in state is not cleared
while account restoration is pending. `LaunchScreen` is a non-interactive branded
placeholder for that initial restoration, never a claim that calling is ready.
Regression coverage lives in `tests/voip/AuthStartup.integration.test.tsx`.
