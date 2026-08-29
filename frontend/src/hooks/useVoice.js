import { useTelnyxVoice } from './useTelnyxVoice';

export function useVoice(token, enabled, identity = {}) {
  return useTelnyxVoice(token, enabled, identity);
}
