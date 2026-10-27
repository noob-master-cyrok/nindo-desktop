import { z } from 'zod';
import type { Row, Store } from './store';
import { casUpdate, type Deps, type SaveResult } from './tasksRepo';

export interface NoteRow {
  id: string;
  owner_id: string;
  parent_type: 'task' | 'festival';
  parent_id: string;
  body: string;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
  revision: number;
  server_updated_at: string;
  [column: string]: unknown;
}

/// Mirrors the `item_notes` check constraints (migration 0002).
const noteSchema = z
  .object({
    id: z.uuid(),
    parent_type: z.enum(['task', 'festival']),
    parent_id: z.string().min(1).max(80),
    body: z.string().trim().min(1, 'Write something first.').max(4000, 'Notes can be at most 4000 characters.'),
    created_at_ms: z.number().int(),
    updated_at_ms: z.number().int(),
    deleted_at_ms: z.number().int().nullable(),
  })
  .loose();

export function validateNote(row: Record<string, unknown>): string[] {
  const result = noteSchema.safeParse(row);
  return result.success ? [] : [...new Set(result.error.issues.map((i) => i.message))];
}

/// Notes attached to a task, with the same compare-and-swap rules as tasks.
export class NotesRepo {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor({ store, now = Date.now, uuid = () => crypto.randomUUID() }: Deps) {
    this.store = store;
    this.now = now;
    this.uuid = uuid;
  }

  async forTask(taskId: string): Promise<NoteRow[]> {
    const rows = await this.store.list('item_notes', { parentId: taskId, from: 0, to: 499 });
    return (rows as unknown as NoteRow[]).sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  async create(taskId: string, body: string): Promise<SaveResult<NoteRow>> {
    const now = this.now();
    const row = {
      id: this.uuid(),
      parent_type: 'task',
      parent_id: taskId,
      body: body.trim(),
      created_at_ms: now,
      updated_at_ms: now,
      deleted_at_ms: null,
    };
    const problems = validateNote(row);
    if (problems.length) return { status: 'invalid', problems };
    const result = await this.store.insert('item_notes', row);
    if (result.kind === 'inserted') return { status: 'saved', row: result.row as unknown as NoteRow };
    const existing = (await this.store.fetchById('item_notes', row.id)) as NoteRow | null;
    return existing ? { status: 'saved', row: existing } : { status: 'gone' };
  }

  update(note: Pick<NoteRow, 'id' | 'revision'>, body: string): Promise<SaveResult<NoteRow>> {
    return casUpdate<NoteRow & Row>(this.store, 'item_notes', note.id, note.revision, { body: body.trim() }, this.now(), (_, row) =>
      validateNote(row),
    );
  }

  remove(note: Pick<NoteRow, 'id' | 'revision'>): Promise<SaveResult<NoteRow>> {
    return casUpdate<NoteRow & Row>(this.store, 'item_notes', note.id, note.revision, { deleted_at_ms: this.now() }, this.now(), (_, row) =>
      validateNote(row),
    );
  }
}
