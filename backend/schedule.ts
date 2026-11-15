import { DateTime } from 'luxon';

const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const pattern = /\b(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{4}-\d{2}-\d{2})\s+(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|[-–—])\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\.?$/i;

export const looksLikeVisit = (text: string) => pattern.test(text.trim());

export type Visit = { start: string; end: string };
export function parseVisit(text: string, zone: string, now: DateTime = DateTime.now()): Visit | undefined {
  const parts = pattern.exec(text.trim());
  if (!parts) return;
  const [, rawDay, startHour, startMinute, startPeriod, endHour, endMinute, endPeriod] = parts;
  if (!startPeriod && !endPeriod && Number(startHour) < 13 && Number(endHour) < 13 && Number(startHour) !== 0) return;
  const localNow = now.setZone(zone);
  const day = rawDay.toLowerCase();
  const weekday = days.indexOf(day.slice(0, 3)) + 1;
  let date = localNow.startOf('day');
  if (day === 'tomorrow') date = date.plus({ days: 1 });
  else if (weekday) date = date.plus({ days: (weekday - localNow.weekday + 7) % 7 });
  else if (day !== 'today') date = DateTime.fromISO(day, { zone });
  const time = (hours: string, minutes = '0', period?: string) => {
    let hour = Number(hours);
    const minute = Number(minutes);
    if (minute > 59 || hour > 23 || (period && (hour < 1 || hour > 12))) return DateTime.invalid('Invalid time');
    if (period) hour = (hour % 12) + (period.toLowerCase() === 'pm' ? 12 : 0);
    const at = date.set({ hour, minute });
    return at.hour === hour && at.minute === minute ? at : DateTime.invalid('Invalid local time');
  };
  let start = time(startHour, startMinute, startPeriod ?? endPeriod);
  let end = time(endHour, endMinute, endPeriod ?? startPeriod);
  if (weekday && start <= localNow) {
    start = start.plus({ days: 7 });
    end = end.plus({ days: 7 });
  }
  if (!start.isValid || !end.isValid || start <= localNow || end <= start) return;
  return { start: start.toISO()!, end: end.toISO()! };
}

export function formatVisit(visit: Visit, zone: string) {
  const start = DateTime.fromISO(visit.start, { zone });
  const end = DateTime.fromISO(visit.end, { zone });
  return `${start.toFormat('ccc, LLL d, h:mm a')}–${end.toFormat('h:mm a ZZZZ')}`;
}
