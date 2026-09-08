/** The token comes from Telnyx; decoding here is only for renewal scheduling. */
export function telnyxTokenLifetime(token: string, now = Date.now()) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const { exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || !Number.isFinite(exp)) throw new Error('Missing expiry');
    const remaining = Math.floor(exp - now / 1000);
    if (remaining <= 0) throw new Error('Expired token');
    return Math.min(86_400, remaining);
  } catch {
    throw new Error('The calling service returned an invalid or expired session.');
  }
}
