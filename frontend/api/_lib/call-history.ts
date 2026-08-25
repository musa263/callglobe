import type { StoredCallEvent } from './call-event-store.js';

export type ServerCallHistory = {
  id: string;
  destination_number: string;
  destination_country: null;
  duration_seconds: number;
  total_cost: number;
  status: 'completed' | 'missed' | 'no_answer' | 'failed';
  started_at: string;
  direction: 'incoming' | 'outgoing';
};

const internalFlows = new Set(['agent', 'queue_agent', 'queue_wait', 'conference_host', 'conference_guest']);

export function callHistoryFromEvents(events: StoredCallEvent[], organizationId: string, limit = 100) {
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
    const outbound = ordered.find((event) => event.flow === 'outbound_destination');
    const inbound = ordered.find((event) => event.direction === 'incoming' && !internalFlows.has(event.flow || ''));
    const anchor = outbound || inbound;
    if (!anchor) continue;
    const direction = outbound ? 'outgoing' : 'incoming';
    const number = direction === 'outgoing' ? anchor.to : anchor.from;
    if (!number) continue;
    const started = ordered.find((event) => event.name === 'call.initiated') || ordered[0];
    const answered = ordered.find((event) => event.name === 'call.answered');
    const ended = [...ordered].reverse().find((event) => event.name === 'call.hangup');
    const startMs = new Date(started.event_timestamp).getTime();
    const answeredMs = answered ? new Date(answered.event_timestamp).getTime() : 0;
    const endedMs = ended ? new Date(ended.event_timestamp).getTime() : 0;
    const durationSeconds = answeredMs && endedMs > answeredMs ? Math.floor((endedMs - answeredMs) / 1000) : 0;
    const cause = ended?.hangup_cause || '';
    const status = answered
      ? 'completed'
      : /timeout|no_answer|originator_cancel|user_busy/i.test(cause) ? (direction === 'incoming' ? 'missed' : 'no_answer') : 'failed';
    calls.push({
      id,
      destination_number: number,
      destination_country: null,
      duration_seconds: durationSeconds,
      total_cost: 0,
      status,
      started_at: Number.isFinite(startMs) ? new Date(startMs).toISOString() : started.event_timestamp,
      direction,
    });
  }
  return calls.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, Math.max(1, Math.min(limit, 200)));
}
