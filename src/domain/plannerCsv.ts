import Papa from 'papaparse';
import { decodeLabels, priorityLabels, statusLabels, type PlannerTask, type Project } from './planner';

const formulaStart = /^[=+\-@\t\r]/;

/// Stops spreadsheet apps from running a cell as a formula.
export function neutralize(value: string): string {
  return formulaStart.test(value) ? `'${value}` : value;
}

export const csvColumns = [
  'title', 'status', 'priority', 'project', 'labels', 'start_date', 'due_date',
  'estimate_minutes', 'critical', 'subtasks', 'description', 'completed_at', 'last_changed', 'id',
] as const;

/// Top-level tasks with their sub-tasks in one column ("[x] " marks done).
export function plannerToCsv(tasks: PlannerTask[], projects: Project[]): string {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const rows = tasks
    .filter((t) => !t.parent_id)
    .map((t) => {
      const subs = tasks.filter((s) => s.parent_id === t.id);
      const row: Record<(typeof csvColumns)[number], string> = {
        title: t.title,
        status: statusLabels[t.status] ?? t.status,
        priority: priorityLabels[t.priority] ?? String(t.priority),
        project: t.project_id ? (names.get(t.project_id) ?? '') : 'Inbox',
        labels: decodeLabels(t.labels).join(', '),
        start_date: t.start_date ?? '',
        due_date: t.due_date ?? '',
        estimate_minutes: t.estimate_minutes == null ? '' : String(t.estimate_minutes),
        critical: t.critical ? 'yes' : '',
        subtasks: subs.map((s) => `${s.status === 'done' ? '[x] ' : ''}${s.title.replace(/\|/g, '/')}`).join(' | '),
        description: t.description,
        completed_at: t.completed_at_ms ? new Date(t.completed_at_ms).toISOString() : '',
        last_changed: t.server_updated_at ?? '',
        id: t.id,
      };
      return csvColumns.map((c) => neutralize(row[c]));
    });
  return Papa.unparse({ fields: [...csvColumns], data: rows });
}
