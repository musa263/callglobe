import { createEvent } from 'ics';

export function calendarEvent(meeting, origin) {
  const url = meeting.kind === 'video' ? `${origin}/?meeting=${encodeURIComponent(meeting.roomId)}` : origin;
  const { error, value } = createEvent({ uid: `${meeting.id}@vocivo`, sequence: meeting.version, title: meeting.title,
    start: Date.parse(meeting.startsAt), startInputType: 'utc', startOutputType: 'utc', duration: { minutes: meeting.durationMinutes },
    description: [meeting.notes, meeting.kind === 'video' ? `Vocivo meeting code: ${meeting.roomId}. Company sign-in required.` : `Call ${meeting.destination}`].filter(Boolean).join('\n'),
    url, productId: 'Vocivo Communications', status: 'CONFIRMED', classification: 'PRIVATE',
    alarms: [{ action: 'display', description: meeting.title, trigger: { minutes: 10, before: true } }],
  });
  if (error || !value) throw new Error('Calendar event could not be generated.');
  return value;
}
export function downloadCalendar(meeting) {
  const url = URL.createObjectURL(new Blob([calendarEvent(meeting, location.origin)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `vocivo-${meeting.id}.ics`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function localDateTime(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function utcDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTime(date) !== value) throw new Error('This local time does not exist. Choose another time.');
  return date.toISOString();
}
