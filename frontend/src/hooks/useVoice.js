import { useFreeswitchVoice } from './useFreeswitchVoice';

export function useVoice(token, enabled, identity = {}) {
  return useFreeswitchVoice(token, enabled, identity);
}
