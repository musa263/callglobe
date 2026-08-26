import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put, readObject, readObjects } from './object-store.js';
import { requiredEnv } from './http.js';

export type StoredUserProfile = {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  mobile: string;
  location: string;
  bio: string;
  photoUrl?: string;
  updatedAt: string;
};

function key() {
  return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest();
}

function userKey(id: string) {
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}

function encrypt(value: StoredUserProfile) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer): StoredUserProfile {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredUserProfile;
}

export async function readUserProfile(id: string) {
  const result = await list({ prefix: `vocivo/profiles/${userKey(id)}/`, limit: 100 });
  const latest = result.blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
  if (!latest) return null;
  try {
    const value = await readObject(latest.pathname);
    return value ? decrypt(value) : null;
  } catch {
    return null;
  }
}

export async function readUserProfiles(ids: string[]) {
  if (!ids.length) return new Map<string, StoredUserProfile>();
  const keys = new Map(ids.map((id) => [userKey(id), id]));
  const result = await list({ prefix: 'vocivo/profiles/', limit: 1000 });
  const latest = new Map<string, { pathname: string; uploadedAt: Date }>();
  for (const blob of result.blobs) {
    const keyPart = blob.pathname.split('/')[2];
    const id = keyPart ? keys.get(keyPart) : undefined;
    if (!id) continue;
    const current = latest.get(id);
    if (!current || blob.uploadedAt.getTime() > current.uploadedAt.getTime()) latest.set(id, blob);
  }
  const objects = await readObjects([...latest.values()].map((blob) => blob.pathname));
  const profiles = new Map<string, StoredUserProfile>();
  for (const [id, blob] of latest) {
    const value = objects.get(blob.pathname);
    if (!value) continue;
    try { profiles.set(id, decrypt(value)); } catch { /* ignore corrupt legacy profiles */ }
  }
  return profiles;
}

export async function saveUserProfile(profile: StoredUserProfile) {
  await put(`vocivo/profiles/${userKey(profile.id)}/${Date.now()}.bin`, encrypt(profile), {
    access: 'public',
    contentType: 'application/octet-stream',
    addRandomSuffix: true,
  });
  return profile;
}

export async function saveProfilePhoto(id: string, input: { base64: string; mimeType: string }) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) throw new Error('Choose a JPEG, PNG, or WebP profile photo.');
  const image = Buffer.from(input.base64, 'base64');
  if (!image.length || image.length > 2_500_000) throw new Error('Profile photos must be smaller than 2.5 MB.');
  const extension = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const blob = await put(`vocivo/profile-photos/${userKey(id)}-${Date.now()}.${extension}`, image, {
    access: 'public',
    contentType: input.mimeType,
    addRandomSuffix: true,
  });
  return blob.url;
}
