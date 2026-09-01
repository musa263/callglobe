import type { VocivoSession } from './auth.js';
import type { ReservedVoiceRoute } from './voice-route-store.js';

export function sessionMayControlVoiceRoute(session: VocivoSession, route: ReservedVoiceRoute) {
  if (route.userId && session.sub && route.userId === session.sub) return true;
  return Boolean(
    session.organizationId
    && session.organizationId === route.organizationId
    && session.extensionId
    && session.extensionId === route.destinationExtensionId,
  );
}
