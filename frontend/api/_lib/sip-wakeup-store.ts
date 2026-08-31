import { put, readObjects, del } from './object-store.js';

export type WakeupDevice = {
  token: string;
  environment: 'production' | 'sandbox';
  platform: 'ios' | 'android';
};

export type WakeupCall = {
  sipCallId: string;
  uuid: string;
  username: string;
  devices: WakeupDevice[];
  createdAt: string;
};

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120) || 'call';
}

function pathname(sipCallId: string) {
  return `vocivo/sip-wakeup/v1/${safeId(sipCallId)}.json`;
}

export async function saveWakeupCall(call: WakeupCall) {
  await put(pathname(call.sipCallId), JSON.stringify(call), { access: 'private', contentType: 'application/json', allowOverwrite: true });
}

export async function readWakeupCall(sipCallId: string) {
  const path = pathname(sipCallId);
  const objects = await readObjects([path]);
  const raw = objects.get(path);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as WakeupCall;
    if (Date.now() - Date.parse(parsed.createdAt) > 120_000) {
      await del(path).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function otherWakeupDevices(call: WakeupCall, answeredToken?: string) {
  const skip = (answeredToken || '').replace(/\s/g, '');
  return call.devices.filter((device) => device.platform === 'ios' && device.token.replace(/\s/g, '') !== skip);
}
