# Shared Mobile Foundation

`api.ts` owns authenticated HTTP/session handling. `types.ts` contains cross-feature
view models; `theme.ts` is the design token source. `components/BottomTabs` and
`BrandMark` are shell primitives. Calling state must remain in calling rather than
this folder. Never add a tenant default to shared HTTP failure handling.
