import { createHash } from 'node:crypto';
import type { ExtensionUser } from './pbx.js';
import type { PbxConfig } from './pbx-config-store.js';
import { organizationExtensionSipUri } from './internal-sip.js';

export type AiTransferTarget = { name: string; to: string };

export function activeAiTransferTargets(
  config: PbxConfig,
  organizationId: string,
  extensions: ExtensionUser[],
): AiTransferTarget[] {
  const seen = new Set<string>();
  return extensions
    .filter((extension) => extension.organizationId === organizationId
      && extension.status === 'active'
      && /^\d{2,5}$/.test(extension.extension)
      && extension.sipUsername.trim())
    .sort((left, right) => Number(left.extension) - Number(right.extension))
    .filter((extension) => {
      if (seen.has(extension.extension)) return false;
      seen.add(extension.extension);
      return true;
    })
    .map((extension) => ({
      name: `${extension.name.trim() || `Extension ${extension.extension}`}, extension ${extension.extension}`,
      to: organizationExtensionSipUri(config, organizationId, extension.sipUsername),
    }));
}

export function aiAssistantInstructions(
  ai: PbxConfig['ai'],
  targets: AiTransferTarget[],
) {
  const directory = targets.length
    ? targets.map((target) => `- ${target.name}`).join('\n')
    : '- No active company extensions are currently available.';
  const transferPolicy = ai.transferEnabled && targets.length
    ? `The caller may request any active colleague or extension listed below. Match either the employee name or extension number and transfer to that exact target. Ask one concise clarifying question when the request is ambiguous. Use extension ${ai.fallbackExtension || 'the configured fallback'} only when the caller asks for a person without naming a colleague or extension. Never claim that transfers are limited to the fallback extension and never transfer outside this directory.\n\nActive company directory:\n${directory}`
    : 'Do not attempt to transfer calls.';
  return `${ai.instructions.trim()}\n\nApproved company information:\n${ai.knowledge.trim() || 'No additional company information has been approved.'}\n\n${transferPolicy}`;
}

export function aiAssistantTools(
  transferEnabled: boolean,
  targets: AiTransferTarget[],
  from: string,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [{ type: 'hangup', hangup: {} }];
  if (transferEnabled && targets.length) {
    if (!/^\+[1-9]\d{6,14}$/.test(from)) throw new Error('AI transfers require a valid server-resolved E.164 caller identity.');
    tools.unshift({ type: 'transfer', transfer: { targets, from } });
  }
  return tools;
}

export function inboundAiRoutingKey(callControlId: string) {
  const digest = createHash('sha256').update(callControlId).digest('hex');
  return `inbound-ai-route:${digest}`;
}

export function inboundAiCommandId(callControlId: string) {
  const digest = createHash('sha256').update(callControlId).digest('hex').slice(0, 32);
  return `vocivo-ai-${digest}`;
}
