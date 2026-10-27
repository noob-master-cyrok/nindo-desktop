import Papa from 'papaparse';
import {
  isValidIsoDate,
  localIsoDate,
  newTaskRow,
  normalizeOffsets,
  repeatSummary,
  urgencyLabels,
  validateTask,
  type NewTask,
  type Step,
  type TaskRow,
} from './task';

export const csvColumns = [
  'id', 'title', 'due_date', 'due_time', 'undated', 'urgency', 'category', 'notes',
  'alert_offsets', 'steps', 'repeat', 'completed_at', 'last_changed',
] as const;

/// Columns read back on import; the rest are informational.
export const importColumns = ['title', 'due_date', 'due_time', 'undated', 'urgency', 'category', 'notes', 'alert_offsets', 'steps'];

const formulaStart = /^[=+\-@\t\r]/;

/// Stops spreadsheet apps from running a cell as a formula.
export function neutralize(value: string): string {
  return formulaStart.test(value) ? `'${value}` : value;
}

/// Undoes [neutralize] so a round trip keeps the original text.
export function unneutralize(value: string): string {
  return value.startsWith("'") && formulaStart.test(value.slice(1)) ? value.slice(1) : value;
}

function stepsToCell(steps: Step[]): string {
  return steps.map((s) => `${s.done ? '[x] ' : ''}${s.title.replace(/\|/g, '/')}`).join(' | ');
}

function cellToSteps(cell: string, uuid: () => string): Step[] {
  return cell
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const done = /^\[x\]\s*/i.test(part);
      return { id: uuid(), title: part.replace(/^\[x\]\s*/i, '').trim(), done };
    });
}

export function tasksToCsv(tasks: TaskRow[]): string {
  const rows = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    due_date: t.undated ? '' : t.due_date_ad,
    due_time: t.due_time ?? '',
    undated: t.undated ? 'true' : 'false',
    urgency: urgencyLabels[t.urgency] ?? String(t.urgency),
    category: t.category ?? '',
    notes: t.notes ?? '',
    alert_offsets: t.alert_offsets,
    steps: stepsToCell(t.steps ?? []),
    repeat: repeatSummary(t),
    completed_at: t.completed_at_ms ? new Date(t.completed_at_ms).toISOString() : '',
    last_changed: t.server_updated_at ?? '',
  }));
  const safe = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, neutralize(String(v))])),
  );
  return Papa.unparse({ fields: [...csvColumns], data: safe.map((r) => csvColumns.map((c) => r[c])) });
}

export interface ImportRow {
  /// Line in the file, counting the header as line 1.
  line: number;
  title: string;
  problems: string[];
  task?: NewTask;
}

function parseUrgency(value: string): number | null {
  if (value === '') return 1;
  if (/^[0-3]$/.test(value)) return Number(value);
  const index = urgencyLabels.findIndex((l) => l.toLowerCase() === value.toLowerCase());
  return index >= 0 ? index : null;
}

function parseBool(value: string): boolean | null {
  const v = value.toLowerCase();
  if (v === '' || v === 'false' || v === 'no' || v === '0') return false;
  if (v === 'true' || v === 'yes' || v === '1') return true;
  return null;
}

/// Parses and validates a CSV file without writing anything. Every row gets
/// a new id and created/updated times of [now].
export function parseImport(
  text: string,
  now: number,
  uuid: () => string = () => crypto.randomUUID(),
  today: string = localIsoDate(new Date(now)),
): { rows: ImportRow[]; fileProblems: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = parsed.meta.fields ?? [];
  const fileProblems: string[] = [];
  if (!fields.includes('title')) fileProblems.push('The file needs a "title" column.');
  if (parsed.data.length > 2000) fileProblems.push('Import at most 2000 rows at a time.');
  if (fileProblems.length) return { rows: [], fileProblems };

  const rows = parsed.data.map((raw, index): ImportRow => {
    const cell = (name: string) => unneutralize((raw[name] ?? '').trim());
    const problems: string[] = [];
    const title = cell('title');

    const undated = parseBool(cell('undated'));
    if (undated === null) problems.push('"undated" must be true or false.');
    const dueDate = cell('due_date');
    if (dueDate && !isValidIsoDate(dueDate)) problems.push('Use a real date as yyyy-mm-dd.');
    if (!dueDate && !undated) problems.push('Add a due date, or set undated to true.');
    const urgency = parseUrgency(cell('urgency'));
    if (urgency === null) problems.push('Urgency must be 0–3 or Info, Normal, Important, Critical.');
    const offsets = normalizeOffsets(cell('alert_offsets'));
    if (offsets === null) problems.push('Alerts are minutes before, like 10,60.');

    const task = newTaskRow(uuid(), now, {
      title,
      due_date_ad: dueDate && isValidIsoDate(dueDate) ? dueDate : today,
      due_time: cell('due_time') || null,
      undated: undated ?? false,
      urgency: urgency ?? 1,
      category: cell('category') || null,
      notes: cell('notes') || null,
      alert_offsets: offsets ?? '',
      steps: cellToSteps(cell('steps'), uuid),
    });
    problems.push(...validateTask(task).filter((p) => !problems.includes(p)));
    return { line: index + 2, title, problems, task: problems.length ? undefined : task };
  });
  return { rows, fileProblems };
}
