import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../_lib/http.js';
import { telnyx, TelnyxApiError } from '../_lib/telnyx.js';

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await requireSession(req);
    const draft = clean(req.body?.draft, 800);
    const recipient = clean(req.body?.recipient, 80);
    const companyName = clean(req.body?.company_name, 100);
    const tone = ['professional', 'friendly', 'concise'].includes(req.body?.tone) ? req.body.tone : 'professional';
    const context = Array.isArray(req.body?.context) ? req.body.context.slice(0, 6).map((item: unknown) => clean(item, 400)).filter(Boolean) : [];
    if (!draft && !context.length) return res.status(400).json({ error: 'Write a draft or select a conversation before requesting AI responses.' });

    const prompt = [
      `Create exactly 3 ${tone} SMS response options.`,
      companyName ? `Write on behalf of ${companyName}.` : '',
      recipient ? `Recipient: ${recipient}.` : '',
      draft ? `User intent or draft: ${draft}` : '',
      context.length ? `Recent messages: ${context.join(' | ')}` : '',
      'Each response must be under 240 characters. Return only a JSON array of three strings.',
    ].filter(Boolean).join('\n');

    const response = await telnyx('/ai/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
        messages: [{ role: 'system', content: 'You are a careful business communications assistant.' }, { role: 'user', content: prompt }],
        temperature: 0.55,
        max_tokens: 240,
      }),
    });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content || '';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('AI did not return usable response options.');
    const suggestions = (JSON.parse(match[0]) as unknown[]).filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 240)).filter(Boolean).slice(0, 3);
    if (!suggestions.length) throw new Error('AI did not return usable response options.');
    return res.status(200).json({ suggestions });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof TelnyxApiError && [400, 403, 404, 422].includes(error.status)) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}
