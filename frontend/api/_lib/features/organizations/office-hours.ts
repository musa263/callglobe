import type { PbxConfig } from './pbx-config-store.js';

type OfficeHours = PbxConfig['officeHours'];
type UserProfile = PbxConfig['userProfiles'][string] | undefined;

const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return {
    weekday: value('weekday'),
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function officeHoursDecision(hours: OfficeHours, at = new Date()) {
  const local = localParts(at, hours.timezone);
  const holiday = hours.holidays.find((item) => item.date === local.date);
  if (holiday) return { open: holiday.destination.trim().toLowerCase() === 'main line', reason: 'holiday' as const, destination: holiday.destination };

  const today = hours.weekdays[local.weekday];
  const todayStart = today ? clockMinutes(today.start) : null;
  const todayEnd = today ? clockMinutes(today.end) : null;
  if (today?.enabled && todayStart !== null && todayEnd !== null) {
    if (todayStart < todayEnd && local.minutes >= todayStart && local.minutes < todayEnd) return { open: true, reason: 'weekly' as const };
    if (todayStart > todayEnd && local.minutes >= todayStart) return { open: true, reason: 'weekly' as const };
  }

  const dayIndex = dayOrder.indexOf(local.weekday);
  const previous = hours.weekdays[dayOrder[(dayIndex + 6) % 7]];
  const previousStart = previous ? clockMinutes(previous.start) : null;
  const previousEnd = previous ? clockMinutes(previous.end) : null;
  if (previous?.enabled && previousStart !== null && previousEnd !== null && previousStart > previousEnd && local.minutes < previousEnd) {
    return { open: true, reason: 'weekly' as const };
  }
  return { open: false, reason: 'closed' as const };
}

export function userAvailableBySchedule(profile: UserProfile, hours: OfficeHours, at = new Date()) {
  if (profile?.schedule === 'Always available') return true;
  return officeHoursDecision(hours, at).open;
}

export function validOfficeTime(value: string) {
  return clockMinutes(value) !== null;
}

export function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
