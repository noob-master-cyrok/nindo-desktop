import { z } from 'zod';

/// One step inside a task. Ids are kept across edits so the phone can match
/// them; new steps get a fresh uuid.
export interface Step {
  id: string;
  title: string;
  done: boolean;
}

/// The known columns of `public.tasks`.
export interface TaskFields {
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

/// A row as the server returns it. Columns the desktop does not edit are
/// still typed so they survive a round trip untouched; any column added later
/// is kept through the index signature.
export interface TaskRow extends TaskFields {
  [column: string]: unknown;
}

/// A new row before the server assigns owner, revision and time.
export type NewTask = Omit<TaskFields, 'owner_id' | 'revision' | 'server_updated_at'>;

/// Fields a person can change from the desktop editor.
export const editableFields = [
  'title',
  'due_date_ad',
  'due_time',
  'undated',
  'urgency',
  'category',
  'notes',
  'alert_offsets',
  'steps',
] as const;
export type EditableField = (typeof editableFields)[number];
export type TaskEdit = Partial<Pick<TaskRow, EditableField | 'completed_at_ms' | 'deleted_at_ms'>>;

/// Columns the server owns. They are never sent in a write.
export const serverOwned = ['owner_id', 'revision', 'server_updated_at'] as const;

export const urgencyLabels = ['Info', 'Normal', 'Important', 'Critical'] as const;

export const repeatRules = [
  'none', 'daily', 'weekly', 'monthAd', 'yearAd', 'monthBs', 'yearBs', 'tithi', 'yearTithi',
] as const;

const repeatLabels: Record<string, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthAd: 'Monthly (AD)',
  yearAd: 'Yearly (AD)',
  monthBs: 'Monthly (BS)',
  yearBs: 'Yearly (BS)',
  tithi: 'Lunar day',
  yearTithi: 'Yearly lunar date',
};

/// A repeating item moves to its next date when completed on the phone, so
/// the desktop must not mark it complete (that would end the series).
/// Undated items never repeat, matching the phone.
export function isRepeating(task: Pick<TaskRow, 'repeat_rule' | 'undated'>): boolean {
  return !task.undated && task.repeat_rule !== 'none';
}

/// Google Calendar events are imported read-only (AGENTS.md §14).
export function isReadOnly(task: Pick<TaskRow, 'kind'>): boolean {
  return task.kind !== 'task';
}

export function repeatSummary(task: TaskRow): string {
  const label = repeatLabels[task.repeat_rule] ?? task.repeat_rule;
  if (task.repeat_rule === 'none') return label;
  const every = task.repeat_interval > 1 ? ` every ${task.repeat_interval}` : '';
  const until = task.repeat_until ? ` until ${task.repeat_until}` : '';
  const count = task.repeat_count ? `, ${task.repeat_count} times` : '';
  return `${label}${every}${until}${count}`;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/// Minutes before the due time, comma separated, as the phone stores them.
export function normalizeOffsets(value: string): string | null {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 525600) return null;
    numbers.push(n);
  }
  return [...new Set(numbers)].sort((a, b) => a - b).join(',');
}

const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, 'Steps need a title.').max(200, 'A step can be at most 200 characters.'),
  done: z.boolean(),
});

const tithiKeys = ['ekadashi', 'ekadashiShukla', 'ekadashiKrishna', 'purnima', 'aunsi'] as const;

/// Mirrors every check constraint on `public.tasks` (migrations 0001–0004)
/// so a person sees a friendly message instead of a database error.
export const taskSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, 'Give the task a title.').max(200, 'Titles can be at most 200 characters.'),
    due_date_ad: z.string().refine(isValidIsoDate, 'Use a real date as yyyy-mm-dd.'),
    date_system: z.enum(['AD', 'BS', 'TITHI']),
    time_zone_policy: z.string().min(1),
    kind: z.string().min(1),
    notes: z.string().max(4000, 'Notes can be at most 4000 characters.').nullable(),
    due_time: z
      .string()
      .regex(/^[0-2][0-9]:[0-5][0-9]$/, 'Use a 24-hour time like 09:30.')
      .refine((t) => Number(t.slice(0, 2)) < 24, 'Use a 24-hour time like 09:30.')
      .nullable(),
    urgency: z.number().int().min(0).max(3),
    category: z.string().max(40, 'Categories can be at most 40 characters.').nullable(),
    undated: z.boolean(),
    repeat_rule: z.enum(repeatRules),
    repeat_interval: z.number().int().min(1).max(99),
    repeat_count: z.number().int().min(1).max(500).nullable(),
    missing_date_policy: z.enum(['skip', 'last']),
    alert_style: z.enum(['notification', 'alarm']),
    tithi_key: z.enum(tithiKeys).nullable(),
    tithi_region: z.string().max(40).nullable(),
    tithi_source: z.string().max(80).nullable(),
    ringtone: z.string().max(80).nullable(),
    anchor_month: z.number().int().nullable(),
    anchor_day: z.number().int().nullable(),
    alert_offsets: z.string().refine((v) => normalizeOffsets(v) !== null, 'Alerts are minutes before, like 10,60.'),
    steps: z.array(stepSchema),
    created_at_ms: z.number().int(),
    updated_at_ms: z.number().int(),
    completed_at_ms: z.number().int().nullable(),
    deleted_at_ms: z.number().int().nullable(),
  })
  .loose()
  .refine(
    (t) => t.repeat_rule !== 'tithi' || (t.tithi_key && t.tithi_region && t.tithi_source),
    'A lunar-day repeat needs its tithi, region and source.',
  )
  .refine(
    (t) =>
      t.repeat_rule !== 'yearTithi' ||
      (t.anchor_month !== null && t.anchor_month >= 1 && t.anchor_month <= 12 &&
        t.anchor_day !== null && t.anchor_day >= 1 && t.anchor_day <= 30 &&
        t.tithi_region && t.tithi_source),
    'A yearly lunar repeat needs its month, tithi, region and source.',
  );

/// Returns a list of friendly problems, empty when the row is valid.
export function validateTask(row: object): string[] {
  const result = taskSchema.safeParse(row);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}

/// Fields for a brand-new task, matching what the phone writes on create.
export function newTaskRow(
  id: string,
  now: number,
  fields: Pick<TaskRow, 'title' | 'due_date_ad'> & Partial<Pick<TaskRow, EditableField>>,
): NewTask {
  return {
    id,
    title: fields.title.trim(),
    due_date_ad: fields.due_date_ad,
    date_system: 'AD',
    time_zone_policy: 'floating_local',
    kind: 'task',
    notes: fields.notes ?? null,
    due_time: fields.due_time ?? null,
    urgency: fields.urgency ?? 1,
    category: fields.category ?? null,
    undated: fields.undated ?? false,
    repeat_rule: 'none',
    repeat_interval: 1,
    repeat_weekdays: '',
    anchor_month: null,
    anchor_day: null,
    missing_date_policy: 'last',
    series_start: null,
    repeat_until: null,
    repeat_count: null,
    repeat_exceptions: '',
    alert_offsets: fields.alert_offsets ?? '',
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

/// Local calendar date as yyyy-MM-dd.
export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
