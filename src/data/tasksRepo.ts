import {
  isReadOnly,
  isRepeating,
  newTaskRow,
  validateTask,
  type EditableField,
  type NewTask,
  type TaskEdit,
  type TaskRow,
} from '../domain/task';
import type { Row, Store, Table } from './store';
import { buildPatch } from './writeRules';

export type SaveResult<T, C = Record<string, unknown>> =
  | { status: 'saved'; row: T }
  /// The row changed on another device since the person opened it. [current]
  /// is the server version; [mine] are the person's unsaved changes.
  | { status: 'conflict'; current: T; mine: C }
  | { status: 'invalid'; problems: string[] }
  /// Deleted (tombstones are final) or no longer visible.
  | { status: 'gone' };

export interface Deps {
  store: Store;
  now?: () => number;
  uuid?: () => string;
}

/// Shared compare-and-swap update (plan section 6). Reads the row fresh,
/// refuses when it moved past [baseRevision], patches only [changes] onto
/// it, and writes only while the revision is unchanged.
export async function casUpdate<T extends Row>(
  store: Store,
  table: Table,
  id: string,
  baseRevision: number,
  changes: Record<string, unknown>,
  now: number,
  check: (fresh: T, row: Record<string, unknown>) => string[],
): Promise<SaveResult<T>> {
  const fresh = (await store.fetchById(table, id)) as T | null;
  if (!fresh || fresh.deleted_at_ms != null) return { status: 'gone' };
  if (fresh.revision !== baseRevision) return { status: 'conflict', current: fresh, mine: changes };

  const patch = buildPatch(fresh, changes, now);
  const problems = check(fresh, { ...patch, id });
  if (problems.length) return { status: 'invalid', problems };

  const saved = (await store.updateIfRevision(table, id, fresh.revision, patch)) as T | null;
  if (saved) return { status: 'saved', row: saved };

  const current = (await store.fetchById(table, id)) as T | null;
  if (!current || current.deleted_at_ms != null) return { status: 'gone' };
  return { status: 'conflict', current, mine: changes };
}

export class TasksRepo {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor({ store, now = Date.now, uuid = () => crypto.randomUUID() }: Deps) {
    this.store = store;
    this.now = now;
    this.uuid = uuid;
  }

  /// Every task this account owns that is not deleted. Personal lists are
  /// small, so pages are read until the end and filtered on this computer.
  async listAll(pageSize = 1000): Promise<TaskRow[]> {
    const out: TaskRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = await this.store.list('tasks', { from, to: from + pageSize - 1 });
      out.push(...(page as unknown as TaskRow[]));
      if (page.length < pageSize) return out;
    }
  }

  async get(id: string): Promise<TaskRow | null> {
    return (await this.store.fetchById('tasks', id)) as TaskRow | null;
  }

  async create(
    fields: Pick<TaskRow, 'title' | 'due_date_ad'> & Partial<Pick<TaskRow, EditableField>>,
  ): Promise<SaveResult<TaskRow>> {
    return this.insert(newTaskRow(this.uuid(), this.now(), fields));
  }

  /// Inserts a prepared new row (from [create] or a CSV import).
  async insert(row: NewTask): Promise<SaveResult<TaskRow>> {
    const problems = validateTask(row);
    if (problems.length) return { status: 'invalid', problems };
    const result = await this.store.insert('tasks', row);
    if (result.kind === 'inserted') return { status: 'saved', row: result.row as unknown as TaskRow };
    // Already there (a retried request): read back what the server holds.
    const existing = await this.get(row.id);
    return existing ? { status: 'saved', row: existing } : { status: 'gone' };
  }

  /// Saves [changes] made to the version of the task the person saw.
  update(id: string, baseRevision: number, changes: TaskEdit): Promise<SaveResult<TaskRow>> {
    return casUpdate<TaskRow & Row>(this.store, 'tasks', id, baseRevision, changes, this.now(), (fresh, row) => {
      if (isReadOnly(fresh)) return ['Imported calendar events are read-only here.'];
      if (changes.completed_at_ms != null && isRepeating(fresh)) {
        return ['Complete repeating tasks on your phone so they move to the next date.'];
      }
      return validateTask(row);
    });
  }

  complete(task: TaskRow): Promise<SaveResult<TaskRow>> {
    return this.update(task.id, task.revision, { completed_at_ms: this.now() });
  }

  reopen(task: TaskRow): Promise<SaveResult<TaskRow>> {
    return this.update(task.id, task.revision, { completed_at_ms: null });
  }

  /// Soft delete. Final: the server never brings a tombstone back.
  remove(task: TaskRow): Promise<SaveResult<TaskRow>> {
    return this.update(task.id, task.revision, { deleted_at_ms: this.now() });
  }
}
