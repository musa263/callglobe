const routeIdPattern = /^[A-Za-z0-9_-]{16,80}$/;

export function isVoiceRouteId(value: unknown): value is string {
  return typeof value === 'string' && routeIdPattern.test(value);
}
