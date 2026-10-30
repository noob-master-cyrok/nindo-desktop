import { z } from 'zod';
import { recurrenceOf, type Recurrence } from './recurrence';

/// Calendar items (the phone's reminders, birthdays, bills, events…), stored
/// in `public.tasks`. Not to be confused with planner tasks (the Tasks tab).

export interface Step {
  id: string;
  title: string;
  done: boolean;
}

export interface ItemFields {
  id: string;
  owner_id: string;
  title: string;
  due_date_ad: string;
  date_system: 'AD' | 'BS' | 'TITHI';
  time_zone_policy: string;
  kind: string;
  notes: string | null;
  due_time: string | null;
  urgency: number;
  category: string | null;
  undated: boolean;
  repeat_rule: string;
  repeat_interval: number;
  repeat_weekdays: string;
  anchor_month: number | null;
  anchor_day: number | null;
  missing_date_policy: string;
  series_start: string | null;
  repeat_until: string | null;
  repeat_count: number | null;
  repeat_exceptions: string;
  alert_offsets: string;
  tithi_key: string | null;
  tithi_region: string | null;
  tithi_source: string | null;
  ringtone: string | null;
  alert_style: string;
  steps: Step[];
  created_at_ms: number;
  updated_at_ms: number;
  completed_at_ms: number | null;
  deleted_at_ms: number | null;
  revision: number;
  server_updated_at: string;
}

/// A row as the server returns it. Unknown columns survive a round trip.
export interface Item extends ItemFields {
  [column: string]: unknown;
}

export type NewItem = Omit<ItemFields, 'owner_id' | 'revision' | 'server_updated_at'>;

/// The phone's kinds, in the order of its add window.
export const kinds = ['reminder', 'task', 'birthday', 'bill', 'renewal', 'appointment', 'event', 'household', 'repayment', 'custom'] as const;
export type Kind = (typeof kinds)[number];

export const kindLabels: Record<string, string> = {
  reminder: 'Reminder',
  task: 'Task',
  birthday: 'Birthday',
  bill: 'Bill',
  renewal: 'Renewal',
  appointment: 'Appointment',
  event: 'Event',
  household: 'Household',
  repayment: 'Repayment',
  custom: 'Custom',
};

export const kindLabel = (kind: string) => kindLabels[kind] ?? 'Item';

export const builtInCategories = ['personal', 'work', 'home', 'health', 'finance', 'family', 'school'] as const;

export const urgencyLabels = ['Info', 'Normal', 'Important', 'Critical'] as const;

/// Alert presets, minutes before the time (the phone's alertOffsetChoices).
export const alertChoices = [0, 5, 15, 30, 60, 120, 1440, 2880, 4320, 10080, 43200] as const;

export function alertLabel(minutes: number): string {
  if (minutes === 0) return 'At the time';
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) return `${minutes / 60} h before`;
  if (minutes % 10080 === 0 && minutes < 43200) return minutes === 10080 ? '1 week before' : `${minutes / 10080} weeks before`;
  if (minutes === 43200) return '1 month before';
  return minutes === 1440 ? '1 day before' : `${Math.round(minutes / 1440)} days before`;
}

export const decodeOffsets = (v: string) => (v ? v.split(',').map(Number).filter((n) => Number.isFinite(n)) : []);
export const encodeOffsets = (v: number[]) => [...new Set(v)].sort((a, b) => a - b).join(',');

export const isDone = (item: Pick<Item, 'completed_at_ms'>) => item.completed_at_ms != null;
export const isCritical = (item: Pick<Item, 'urgency'>) => item.urgency >= 3;
export const recurrence = (item: Item): Recurrence => recurrenceOf(item);

/// Overdue: open, dated, and due before today (or earlier today with a
/// time already passed).
export function isOverdue(item: Item, today: string, nowHm?: string): boolean {
  if (isDone(item) || item.undated) return false;
  if (item.due_date_ad < today) return true;
  return item.due_date_ad === today && !!item.due_time && !!nowHm && item.due_time < nowHm;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, 'Steps need a title.').max(200, 'A step can be at most 200 characters.'),
  done: z.boolean(),
});

/// Mirrors the check constraints on `public.tasks` (migrations 0001–0004).
const itemSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, 'Give it a name.').max(200, 'Names can be at most 200 characters.'),
    due_date_ad: z.string().refine(isValidIsoDate, 'Pick a real date.'),
    date_system: z.enum(['AD', 'BS', 'TITHI']),
    kind: z.string().min(1),
    notes: z.string().max(4000, 'The description can be at most 4000 characters.').nullable(),
    due_time: z
      .string()
      .regex(/^[0-2][0-9]:[0-5][0-9]$/, 'Use a time like 09:30.')
      .refine((t) => Number(t.slice(0, 2)) < 24, 'Use a time like 09:30.')
      .nullable(),
    urgency: z.number().int().min(0).max(3),
    category: z.string().max(40, 'Categories can be at most 40 characters.').nullable(),
    undated: z.boolean(),
    repeat_rule: z.enum(['none', 'daily', 'weekly', 'monthAd', 'yearAd', 'monthBs', 'yearBs', 'tithi', 'yearTithi']),
    repeat_interval: z.number().int().min(1, 'Repeat at least every 1.').max(99, 'Repeat at most every 99.'),
    repeat_count: z.number().int().min(1).max(500, 'At most 500 times.').nullable(),
    missing_date_policy: z.enum(['skip', 'last']),
    steps: z.array(stepSchema),
  })
  .loose();

export function validateItem(row: object): string[] {
  const result = itemSchema.safeParse(row);
  return result.success ? [] : [...new Set(result.error.issues.map((i) => i.message))];
}

export type ItemEdit = Partial<
  Pick<
    Item,
    | 'title'
    | 'kind'
    | 'due_date_ad'
    | 'due_time'
    | 'undated'
    | 'urgency'
    | 'category'
    | 'notes'
    | 'alert_offsets'
    | 'steps'
    | 'date_system'
    | 'repeat_rule'
    | 'repeat_interval'
    | 'repeat_weekdays'
    | 'anchor_month'
    | 'anchor_day'
    | 'missing_date_policy'
    | 'series_start'
    | 'repeat_until'
    | 'repeat_count'
    | 'repeat_exceptions'
    | 'completed_at_ms'
    | 'deleted_at_ms'
  >
>;

/// A brand-new item as the phone writes one.
export function newItemRow(id: string, now: number, fields: ItemEdit & Pick<Item, 'title' | 'due_date_ad'>): NewItem {
  return {
    id,
    title: fields.title.trim(),
    due_date_ad: fields.due_date_ad,
    date_system: fields.date_system ?? 'AD',
    time_zone_policy: 'floating_local',
    kind: fields.kind ?? 'reminder',
    notes: fields.notes?.trim() ? fields.notes.trim() : null,
    due_time: fields.undated ? null : (fields.due_time ?? null),
    urgency: fields.urgency ?? 1,
    category: fields.category ?? null,
    undated: fields.undated ?? false,
    repeat_rule: fields.undated ? 'none' : (fields.repeat_rule ?? 'none'),
    repeat_interval: fields.repeat_interval ?? 1,
    repeat_weekdays: fields.repeat_weekdays ?? '',
    anchor_month: fields.anchor_month ?? null,
    anchor_day: fields.anchor_day ?? null,
    missing_date_policy: fields.missing_date_policy ?? 'last',
    series_start: fields.series_start ?? null,
    repeat_until: fields.repeat_until ?? null,
    repeat_count: fields.repeat_count ?? null,
    repeat_exceptions: fields.repeat_exceptions ?? '',
    alert_offsets: fields.alert_offsets ?? (fields.due_time ? '0' : ''),
    tithi_key: null,
    tithi_region: null,
    tithi_source: null,
    ringtone: null,
    alert_style: 'notification',
    steps: fields.steps ?? [],
    created_at_ms: now,
    updated_at_ms: now,
    completed_at_ms: null,
    deleted_at_ms: null,
  };
}

/// Sort for lists: open first, then by date and time (undated last), then
/// more urgent first, then name.
export function compareItems(a: Item, b: Item): number {
  const done = Number(isDone(a)) - Number(isDone(b));
  if (done) return done;
  const da = a.undated ? '9999' : a.due_date_ad;
  const db = b.undated ? '9999' : b.due_date_ad;
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.due_time ?? '99:99';
  const tb = b.due_time ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.urgency !== b.urgency) return b.urgency - a.urgency;
  return a.title.localeCompare(b.title);
}

/// "9:30" in 24-hour, "All day" when there is no time.
export const timeLabel = (item: Pick<Item, 'due_time'>) => item.due_time ?? 'All day';
