/** Signing determines APNs routing; Release JS can run in a development-signed app. */
export function pushEnvironment(nativeValue: unknown, development: boolean): 'sandbox' | 'production' {
  if (nativeValue === 'sandbox' || nativeValue === 'production') return nativeValue;
  return development ? 'sandbox' : 'production'; // Compatibility with older installed native modules.
}
