import { voiceWalletCharge } from './inbound-billing.js';
import { readVoiceRoute } from './voice-route-store.js';
import { chargeOutboundPstnUsage } from './wallet-store.js';

export async function maybeChargeOutboundHangup(
  routeId: string | undefined,
  eventId: string,
  durationSecondsOverride?: number,
) {
  if (!routeId || !eventId) return { charged: false as const };
  if (!voiceWalletCharge('outbound').charged) return { charged: false as const };
  const route = await readVoiceRoute(routeId);
  if (!route || route.flow !== 'outbound' || !route.organizationId) return { charged: false as const };
  const started = Date.parse(route.connectedAt || '');
  const fromConnected = Number.isFinite(started) ? Math.max(0, (Date.now() - started) / 1000) : NaN;
  const durationSeconds = Number.isFinite(durationSecondsOverride)
    ? Math.max(0, durationSecondsOverride as number)
    : fromConnected;
  if (!Number.isFinite(durationSeconds)) return { charged: false as const };
  const ratePerMinuteMinor = Number.parseInt(process.env.VOCIVO_OUTBOUND_RATE_MINOR || '10', 10);
  return chargeOutboundPstnUsage({
    organizationId: route.organizationId,
    durationSeconds,
    ratePerMinuteMinor: Number.isSafeInteger(ratePerMinuteMinor) && ratePerMinuteMinor > 0 ? ratePerMinuteMinor : 10,
    reference: route.destination || routeId,
    idempotencyKey: `pstn:${eventId}`,
  });
}
