import type { StoredCallEvent } from './call-event-store.js';

export type ServerCallHistory = {
  id: string;
  destination_number: string;
  destination_name?: string;
  destination_country: string | null;
  duration_seconds: number;
  total_cost: number;
  status: 'completed' | 'missed' | 'no_answer' | 'failed';
  started_at: string;
  direction: 'incoming' | 'outgoing';
  internal?: boolean;
};

export type HistoryDirectoryEntry = { id: string; extension: string; name: string; sipUsername: string };
export type HistoryViewer = { extensionId?: string; extension?: string; directory?: HistoryDirectoryEntry[] };

const internalAgentFlows = new Set(['agent', 'queue_agent', 'queue_wait', 'conference_host', 'conference_guest']);

function sipUsername(value?: string) { return value?.match(/^sip:([^@]+)@/i)?.[1] || ''; }
function first(values: StoredCallEvent[], key: keyof StoredCallEvent) {
  const value = values.find((event) => typeof event[key] === 'string' && event[key])?.[key];
  return typeof value === 'string' ? value : '';
}

function timing(values: StoredCallEvent[]) {
  const started = values.find((event) => event.name === 'call.initiated') || values[0]!;
  const answered = values.find((event) => event.name === 'call.answered');
  const ended = [...values].reverse().find((event) => event.name === 'call.hangup');
  const startMs = new Date(started.event_timestamp).getTime();
  const answeredMs = answered ? new Date(answered.event_timestamp).getTime() : 0;
  const endedMs = ended ? new Date(ended.event_timestamp).getTime() : 0;
  return {
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : started.event_timestamp,
    answered,
    cause: ended?.hangup_cause || '',
    durationSeconds: answeredMs && endedMs > answeredMs ? Math.floor((endedMs - answeredMs) / 1000) : 0,
  };
}

function callStatus(answered: StoredCallEvent | undefined, cause: string, direction: 'incoming' | 'outgoing') {
  return answered
    ? 'completed' as const
    : /timeout|no_answer|originator_cancel|user_busy/i.test(cause)
      ? direction === 'incoming' ? 'missed' as const : 'no_answer' as const
      : 'failed' as const;
}

function internalHistory(id: string, values: StoredCallEvent[], viewer: HistoryViewer): ServerCallHistory | null {
  const directory = viewer.directory || [];
  const sourceById = directory.find((entry) => entry.id === first(values, 'sourceExtensionId'));
  const destinationById = directory.find((entry) => entry.id === first(values, 'destinationExtensionId'));
  const internalRequest = values.find((event) => event.flow === 'internal');
  const destinationLeg = values.find((event) => event.flow === 'outbound_destination');
  const sourceBySip = directory.find((entry) => entry.sipUsername === sipUsername(internalRequest?.from));
  const destinationBySip = directory.find((entry) => entry.sipUsername === sipUsername(destinationLeg?.to || internalRequest?.to));
  const source = sourceById || sourceBySip;
  const destination = destinationById || destinationBySip;
  const sourceId = first(values, 'sourceExtensionId') || source?.id || '';
  const destinationId = first(values, 'destinationExtensionId') || destination?.id || '';
  const sourceExtension = first(values, 'sourceExtension') || source?.extension || '';
  const destinationExtension = first(values, 'destinationExtension') || destination?.extension || '';
  const sourceName = first(values, 'sourceName') || source?.name || (sourceExtension ? `Extension ${sourceExtension}` : 'Colleague');
  const destinationName = first(values, 'destinationName') || destination?.name || (destinationExtension ? `Extension ${destinationExtension}` : 'Colleague');
  const viewerIsSource = Boolean((viewer.extensionId && sourceId === viewer.extensionId) || (viewer.extension && sourceExtension === viewer.extension));
  const viewerIsDestination = Boolean((viewer.extensionId && destinationId === viewer.extensionId) || (viewer.extension && destinationExtension === viewer.extension));
  if ((viewer.extensionId || viewer.extension) && !viewerIsSource && !viewerIsDestination) return null;
  const direction = viewerIsDestination && !viewerIsSource ? 'incoming' as const : 'outgoing' as const;
  const peerName = direction === 'incoming' ? sourceName : destinationName;
  const peerExtension = direction === 'incoming' ? sourceExtension : destinationExtension;
  const time = timing(values);
  return {
    id,
    destination_number: peerExtension || 'Internal extension',
    destination_name: peerName,
    destination_country: 'Internal',
    duration_seconds: time.durationSeconds,
    total_cost: 0,
    status: callStatus(time.answered, time.cause, direction),
    started_at: time.startedAt,
    direction,
    internal: true,
  };
}

export function callHistoryFromEvents(events: StoredCallEvent[], organizationId: string, limit = 100, viewer: HistoryViewer = {}) {
  const sessions = new Map<string, StoredCallEvent[]>();
  for (const event of events) {
    if (event.organizationId !== organizationId) continue;
    const id = event.call_session_id || event.call_leg_id || event.call_control_id;
    if (!id) continue;
    sessions.set(id, [...(sessions.get(id) || []), event]);
  }

  const calls: ServerCallHistory[] = [];
  for (const [id, values] of sessions) {
    const ordered = values.sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp));
    const isInternal = ordered.some((event) => event.flow === 'internal' || event.sourceExtensionId || event.destinationExtensionId);
    if (isInternal) {
      const call = internalHistory(id, ordered, viewer);
      if (call) calls.push(call);
      continue;
    }
    const outbound = ordered.find((event) => event.flow === 'outbound_destination');
    const inbound = ordered.find((event) => event.direction === 'incoming' && !internalAgentFlows.has(event.flow || ''));
    const anchor = outbound || inbound;
    if (!anchor) continue;
    const direction = outbound ? 'outgoing' as const : 'incoming' as const;
    const number = direction === 'outgoing' ? anchor.to : anchor.from;
    if (!number || /^sip:/i.test(number)) continue;
    const time = timing(ordered);
    calls.push({
      id,
      destination_number: number,
      destination_country: null,
      duration_seconds: time.durationSeconds,
      total_cost: 0,
      status: callStatus(time.answered, time.cause, direction),
      started_at: time.startedAt,
      direction,
    });
  }
  return calls.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, Math.max(1, Math.min(limit, 200)));
}
