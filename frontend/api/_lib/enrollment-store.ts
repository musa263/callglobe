import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';

function path(jti: string) {
  return `vocivo/enrollment-consumed/${createHash('sha256').update(jti).digest('hex')}.txt`;
}

export async function consumeEnrollment(jti: string) {
  try {
    await put(path(jti), 'consumed', { access: 'public', contentType: 'text/plain', allowOverwrite: false });
  } catch {
    throw new Error('This enrollment code has already been used.');
  }
}
