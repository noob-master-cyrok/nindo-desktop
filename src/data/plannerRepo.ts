import {
  decodeLabels,
  encodeLabels,
  isClosed,
  newTask,
  orderAt,
  sortTasks,
  statusChange,
  validateTask,
  type Activity,
  type Link,
  type PlannerTask,
  type Project,
  type Status,
  type TaskEdit,
} from '../domain/planner';
import type { Store, Table } from './store';
import { buildPatch } from './writeRules';
import type { AttendanceDay, Break, BreakRun, Session, TimeData } from '../domain/time';

export type SaveResult<T> =
  | { status: 'saved'; row: T }
  /// The row changed on another device since the person opened it. [current]
  /// is the server version; [mine] are the person's unsaved changes.
  | { status: 'conflict'; current: T; mine: Record<string, unknown> }
  | { status: 'invalid'; problems: string[] }
  /// Deleted or no longer visible.
  | { status: 'gone' };

/// Compare-and-swap update: reads the row fresh, refuses when it moved past
/// [baseRevision], patches only [changes] onto it (every other column is kept
/// as it is), and writes only while the revision is unchanged.
export async function casUpdate<T>(
  store: Store,
  table: Table,
  id: string,
  baseRevision: number,
  changes: Record<string, unknown>,
  now: number,
  check: (row: Record<string, unknown>) => string[] = () => [],
): Promise<SaveResult<T>> {
  const fresh = await store.fetchById(table, id);
  if (!fresh || fresh.deleted_at_ms != null) return { status: 'gone' };
  if (fresh.revision !== baseRevision) return { status: 'conflict', current: fresh as T, mine: changes };

  const patch = buildPatch(fresh, changes, now);
  const problems = check({ ...patch, id });
  if (problems.length) return { status: 'invalid', problems };

  const saved = await store.updateIfRevision(table, id, fresh.revision, patch);
  if (saved) return { status: 'saved', row: saved as T };

  const current = await store.fetchById(table, id);
  if (!current || current.deleted_at_ms != null) return { status: 'gone' };
  return { status: 'conflict', current: current as T, mine: changes };
}

export interface Deps {
  store: Store;
  now?: () => number;
  uuid?: () => string;
}

/// The planner (the phone's Tasks tab) over the synced tables. Writes follow
/// the phone: a status change keeps completed_at_ms in step, and changes the
/// phone records in a task's history are recorded here too.
export class PlannerRepo {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor({ store, now = Date.now, uuid = () => crypto.randomUUID() }: Deps) {
    this.store = store;
    this.now = now;
    this.uuid = uuid;
  }

  private async all<T>(table: Table, eq?: Record<string, string>, pageSize = 1000): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = await this.store.list(table, { eq, from, to: from + pageSize - 1 });
      out.push(...(page as T[]));
      if (page.length < pageSize) return out;
    }
  }

  /// Every task (sub-tasks included) and project that is not deleted.
  async load(): Promise<{ tasks: PlannerTask[]; projects: Project[] }> {
    const [tasks, projects] = await Promise.all([
      this.all<PlannerTask>('planner_tasks'),
      this.all<Project>('planner_projects'),
    ]);
    return { tasks, projects: projects.sort((a, b) => a.sort_order - b.sort_order || a.created_at_ms - b.created_at_ms) };
  }

  async get(id: string): Promise<PlannerTask | null> {
    return (await this.store.fetchById('planner_tasks', id)) as PlannerTask | null;
  }

  async details(taskId: string): Promise<{ links: Link[]; activity: Activity[] }> {
    const [links, activity] = await Promise.all([
      this.all<Link>('planner_links', { task_id: taskId }),
      this.all<Activity>('planner_activity', { task_id: taskId }),
    ]);
    return {
      links: links.sort((a, b) => a.created_at_ms - b.created_at_ms),
      activity: activity.sort((a, b) => a.created_at_ms - b.created_at_ms),
    };
  }

  private async insert<T>(table: Table, values: Record<string, unknown>): Promise<SaveResult<T>> {
    const result = await this.store.insert(table, values);
    if (result.kind === 'inserted') return { status: 'saved', row: result.row as T };
    // Already there (a retried request): read back what the server holds.
    const existing = await this.store.fetchById(table, values.id as string);
    return existing ? { status: 'saved', row: existing as T } : { status: 'gone' };
  }

  private log(taskId: string, kind: string, body: string): Promise<SaveResult<Activity>> {
    const now = this.now();
    return this.insert('planner_activity', {
      id: this.uuid(),
      task_id: taskId,
      kind,
      body,
      created_at_ms: now,
      updated_at_ms: now,
      deleted_at_ms: null,
    });
  }

  /// A new task at the end of its status group ([siblings] are the tasks
  /// already loaded, used for the order).
  async create(
    fields: Pick<PlannerTask, 'title'> & Partial<PlannerTask>,
    siblings: PlannerTask[] = [],
  ): Promise<SaveResult<PlannerTask>> {
    const status = fields.status ?? 'todo';
    const last = Math.max(0, ...siblings.filter((t) => t.status === status).map((t) => t.sort_order));
    const row = newTask(this.uuid(), this.now(), { sort_order: last + 1, ...fields, status });
    const problems = validateTask(row);
    if (problems.length) return { status: 'invalid', problems };
    const result = await this.insert<PlannerTask>('planner_tasks', row);
    if (result.status === 'saved' && !row.parent_id) await this.log(row.id, 'created', '');
    return result;
  }

  /// Saves [changes] made to the version of the task the person saw.
  async update(task: Pick<PlannerTask, 'id' | 'revision' | 'parent_id'>, changes: TaskEdit): Promise<SaveResult<PlannerTask>> {
    const result = await casUpdate<PlannerTask>(this.store, 'planner_tasks', task.id, task.revision, changes, this.now(), validateTask);
    if (result.status === 'saved' && !task.parent_id) await this.logChanges(task.id, changes);
    return result;
  }

  private async logChanges(id: string, changes: TaskEdit) {
    const names = ['none', 'low', 'medium', 'high', 'urgent'];
    if (changes.status !== undefined) await this.log(id, 'status', changes.status);
    if (changes.priority !== undefined) await this.log(id, 'priority', names[changes.priority] ?? String(changes.priority));
    if (changes.due_date !== undefined) await this.log(id, 'due', changes.due_date ?? '');
    if (changes.project_id !== undefined) await this.log(id, 'project', changes.project_id ?? '');
    if (changes.critical !== undefined) await this.log(id, 'critical', changes.critical ? '1' : '0');
  }

  setStatus(task: PlannerTask, status: Status): Promise<SaveResult<PlannerTask>> {
    return this.update(task, statusChange(task, status, this.now()));
  }

  /// Ticks a sub-task: done, or back to to do.
  toggleSubtask(sub: PlannerTask): Promise<SaveResult<PlannerTask>> {
    return this.setStatus(sub, isClosed(sub.status) ? 'todo' : 'done');
  }

  /// Soft delete with its sub-tasks, like the phone.
  async remove(task: PlannerTask, subtasks: PlannerTask[]): Promise<SaveResult<PlannerTask>> {
    const now = this.now();
    const result = await casUpdate<PlannerTask>(this.store, 'planner_tasks', task.id, task.revision, { deleted_at_ms: now }, now);
    if (result.status !== 'saved') return result;
    for (const sub of subtasks) {
      await casUpdate(this.store, 'planner_tasks', sub.id, sub.revision, { deleted_at_ms: now }, now);
    }
    return result;
  }

  /// Puts a deleted task and its sub-tasks back (Undo after a delete).
  async restore(task: PlannerTask, subtasks: PlannerTask[]): Promise<SaveResult<PlannerTask>> {
    const now = this.now();
    const back = async (row: PlannerTask) => {
      const fresh = await this.store.fetchById('planner_tasks', row.id);
      if (!fresh) return null;
      return this.store.updateIfRevision('planner_tasks', row.id, fresh.revision, buildPatch(fresh, { deleted_at_ms: null }, now));
    };
    const saved = await back(task);
    if (!saved) return { status: 'gone' };
    for (const sub of subtasks) await back(sub);
    return { status: 'saved', row: saved as unknown as PlannerTask };
  }

  /// Drops [task] into [status] just before [beforeId], or at the end (the
  /// board's drag), with [all] the tasks loaded now.
  move(task: PlannerTask, status: Status, beforeId: string | null, all: PlannerTask[]): Promise<SaveResult<PlannerTask>> {
    const column = sortTasks(
      all.filter((t) => !t.parent_id && t.status === status && t.id !== task.id),
      'manual',
    );
    const at = column.findIndex((t) => t.id === beforeId);
    const changes = { ...statusChange(task, status, this.now()), sort_order: orderAt(column, at < 0 ? column.length : at) };
    return this.update(task, changes);
  }

  /// A copy with its sub-tasks and links, "(copy)" added, as on the phone.
  async duplicate(task: PlannerTask, all: PlannerTask[]): Promise<SaveResult<PlannerTask>> {
    const copy = await this.create(
      {
        title: `${task.title} (copy)`.slice(0, 300),
        project_id: task.project_id,
        status: 'todo',
        priority: task.priority,
        due_date: task.due_date,
        description: task.description,
        labels: encodeLabels(decodeLabels(task.labels)),
      },
      all,
    );
    if (copy.status !== 'saved') return copy;
    const subs = sortTasks(all.filter((t) => t.parent_id === task.id), 'manual');
    for (const s of subs) await this.create({ title: s.title, parent_id: copy.row.id, project_id: task.project_id }, all);
    const { links } = await this.details(task.id);
    for (const l of links) await this.addLink(copy.row.id, l.url, l.title ?? '');
    return copy;
  }

  /// History lines written since [sinceMs], for Today's highlights.
  activitySince(sinceMs: number): Promise<Activity[]> {
    return this.allSince<Activity>('planner_activity', sinceMs);
  }

  private async allSince<T>(table: Table, sinceMs: number, pageSize = 1000): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = await this.store.list(table, { since: { column: 'created_at_ms', value: sinceMs }, from, to: from + pageSize - 1 });
      out.push(...(page as T[]));
      if (page.length < pageSize) return out;
    }
  }

  /// Worked time, breaks and attendance since [sinceMs] (this week and
  /// today). Empty before the phone has uploaded them, or when the server has
  /// no such tables yet.
  async timeSince(sinceMs: number): Promise<TimeData | null> {
    const since = { column: 'started_at_ms', value: sinceMs };
    try {
      const [sessions, runs, breaks, attendance] = await Promise.all([
        this.pages<Session>('planner_sessions', since),
        this.pages<BreakRun>('planner_break_runs', since),
        this.pages<Break>('planner_breaks'),
        this.pages<AttendanceDay>('planner_attendance', { column: 'updated_at_ms', value: sinceMs }),
      ]);
      return { sessions, runs, breaks, attendance };
    } catch (e) {
      console.warn('[nindo] time data unavailable', e instanceof Error ? e.message : 'error');
      return null;
    }
  }

  private async pages<T>(table: Table, since?: { column: string; value: number }): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await this.store.list(table, { since, from, to: from + 999 });
      out.push(...(page as T[]));
      if (page.length < 1000) return out;
    }
  }

  /// Sets one day's check-in, check-out and note by hand, as the phone's
  /// attendance sheet does ([day] is yyyy-mm-dd).
  async saveAttendance(
    day: string,
    values: { check_in_ms: number | null; check_out_ms: number | null; note: string },
  ): Promise<SaveResult<AttendanceDay>> {
    if (values.note.length > 2000) return { status: 'invalid', problems: ['The note is too long.'] };
    const now = this.now();
    const existing = (await this.store.fetchById('planner_attendance', day)) as AttendanceDay | null;
    if (!existing) {
      return this.insert<AttendanceDay>('planner_attendance', {
        id: day,
        ...values,
        edited: true,
        created_at_ms: now,
        updated_at_ms: now,
        deleted_at_ms: null,
      });
    }
    if (existing.deleted_at_ms != null) {
      // A day removed on the phone comes back with these values.
      const patch = buildPatch(existing as unknown as Record<string, unknown>, { ...values, edited: true, deleted_at_ms: null }, now);
      const saved = await this.store.updateIfRevision('planner_attendance', day, existing.revision, patch);
      return saved ? { status: 'saved', row: saved as unknown as AttendanceDay } : { status: 'gone' };
    }
    return casUpdate<AttendanceDay>(this.store, 'planner_attendance', day, existing.revision, { ...values, edited: true, deleted_at_ms: null }, now);
  }

  async createProject(name: string, color: number, existing: Project[]): Promise<SaveResult<Project>> {
    const clean = name.trim();
    if (!clean || clean.length > 80) return { status: 'invalid', problems: ['Project names are 1 to 80 characters.'] };
    const now = this.now();
    return this.insert('planner_projects', {
      id: this.uuid(),
      name: clean,
      color,
      sort_order: existing.length,
      archived: false,
      created_at_ms: now,
      updated_at_ms: now,
      deleted_at_ms: null,
    });
  }

  async addLink(taskId: string, url: string, title: string): Promise<SaveResult<Link>> {
    const clean = url.trim();
    if (!/^https?:\/\/\S+$/i.test(clean)) return { status: 'invalid', problems: ['Use a full web address starting with https://'] };
    const now = this.now();
    const result = await this.insert<Link>('planner_links', {
      id: this.uuid(),
      task_id: taskId,
      url: clean,
      title: title.trim() || null,
      created_at_ms: now,
      updated_at_ms: now,
      deleted_at_ms: null,
    });
    if (result.status === 'saved') await this.log(taskId, 'link', title.trim() || clean);
    return result;
  }

  removeLink(link: Link): Promise<SaveResult<Link>> {
    return casUpdate<Link>(this.store, 'planner_links', link.id, link.revision, { deleted_at_ms: this.now() }, this.now());
  }

  async comment(taskId: string, text: string): Promise<SaveResult<Activity>> {
    const body = text.trim();
    if (!body) return { status: 'invalid', problems: ['Write something first.'] };
    return this.log(taskId, 'comment', body);
  }
}
