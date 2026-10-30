import { addDays } from './dates';
import { kindLabel, type Item } from './item';

/// An iCalendar file of items, for Apple Calendar, Google Calendar or
/// Outlook (the phone's calendar export). Timed items last 30 minutes;
/// others are all-day. Repeats are written out as their dates already
/// worked out by the caller.

const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/// Long lines fold at 75 octets, as the standard asks.
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = (iso: string) => iso.replace(/-/g, '');

export function toIcs(entries: { item: Item; date: string }[], now = Date.now()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nindo//Desktop//EN', 'CALSCALE:GREGORIAN'];
  for (const { item, date } of entries) {
    lines.push('BEGIN:VEVENT', `UID:${item.id}-${date}@nindo`, `DTSTAMP:${stamp(now)}`);
    if (item.due_time) {
      const [h, m] = item.due_time.split(':').map(Number) as [number, number];
      const end = h * 60 + m + 30;
      const endDate = end >= 1440 ? addDays(date, 1) : date;
      const endHm = `${String(Math.floor((end % 1440) / 60)).padStart(2, '0')}${String(end % 60).padStart(2, '0')}`;
      lines.push(`DTSTART:${day(date)}T${item.due_time.replace(':', '')}00`, `DTEND:${day(endDate)}T${endHm}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(date)}`, `DTEND;VALUE=DATE:${day(addDays(date, 1))}`);
    }
    lines.push(`SUMMARY:${escape(item.title)}`, `CATEGORIES:${escape(kindLabel(item.kind))}`);
    if (item.notes) lines.push(`DESCRIPTION:${escape(item.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
