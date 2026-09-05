# Mobile Authentication

`AuthContext` restores/changes the signed-in account and synchronizes native
authentication gates. `screens/AuthScreen` renders credential/enrollment input.
`shared/api` owns HTTP/session persistence. Calling bootstrap is separately owned
by calling/runtime so a native wake need not wait for visual screen loading.

Sign-out must revoke calling/push access, not only navigate away. Test session
restoration, rejection and logout during pending registration using `npm test`;
run typecheck after changing context contracts.
