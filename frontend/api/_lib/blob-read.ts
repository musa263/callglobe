import { get } from '@vercel/blob';

export async function readFreshPublicBlob(pathname: string) {
  const result = await get(pathname, { access: 'public', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
