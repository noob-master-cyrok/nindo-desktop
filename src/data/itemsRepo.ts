import { z } from 'zod';
import { newItemRow, recurrence, validateItem, type Item, type ItemEdit } from '../domain/item';
import { desktopCanRepeat, nextFrom, recurrenceColumns, repeats } from '../domain/recurrence';
import { casUpdate, type Deps, type SaveResult } from './plannerRepo';
import type { Store } from './store';

/// Calendar items and their notes over `public.tasks` and `public.item_notes`
/// (migrations 0001–0002), written the way the phone writes them.

export interface Note {
  id: string;
  owner_id: string;
  parent_type: 'task' | 'festival';
  parent_id: string;
  body: string;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
  revision: number;
  [column: string]: unknown;
}

const noteSchema = z
  .object({
    parent_type: z.enum(['task', 'festival']),
    parent_id: z.string().min(1).max(80),
    body: z.string().trim().min(1, 'Write something first.').max(4000, 'Notes can be at most 4000 characters.'),
  })
  .loose();

const validateNote = (row: object) => {
  const r = noteSchema.safeParse(row);
  return r.success ? [] : [...new Set(r.error.issues.map((i) => i.message))];
};

/// The phone's XP rules: 10 per occurrence, none for items finished within a
/// minute of creating them, at most 100 a day.
export const xpPerCompletion = 10;
export const dailyXpCap = 100;
const minimumAgeMs = 60_000;

export interface CompleteOutcome {
  result: SaveResult<Item>;
  /// The next date when a repeating item moved on instead of closing.
  nextDue: string | null;
  xp: 'awarded' | 'alreadyCounted' | 'tooSoon' | 'dailyCap' | 'none';
}

export class ItemsRepo {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor({ store, now = Date.now, uuid = () => crypto.randomUUID() }: Deps) {
    this.store = store;
    this.now = now;
    this.uuid = uuid;
  }

  async listAll(pageSize = 1000): Promise<Item[]> {
    const out: Item[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = await this.store.list('tasks', { from, to: from + pageSize - 1 });
      out.push(...(page as unknown as Item[]));
      if (page.length < pageSize) return out;
    }
  }

  async create(fields: ItemEdit & Pick<Item, 'title' | 'due_date_ad'>): Promise<SaveResult<Item>> {
    const row = newItemRow(this.uuid(), this.now(), fields);
    const problems = validateItem(row);
    if (problems.length) return { status: 'invalid', problems };
    const result = await this.store.insert('tasks', row);
    if (result.kind === 'inserted') return { status: 'saved', row: result.row as unknown as Item };
    const existing = (await this.store.fetchById('tasks', row.id)) as Item | null;
    return existing ? { status: 'saved', row: existing } : { status: 'gone' };
  }

  update(item: Pick<Item, 'id' | 'revision'>, changes: ItemEdit): Promise<SaveResult<Item>> {
    return casUpdate<Item>(this.store, 'tasks', item.id, item.revision, changes, this.now(), validateItem);
  }

  /// Completes the current occurrence. A repeating item moves to its next
  /// date on or after [today] and its steps are unticked; otherwise, or with
  /// [whole], it is marked complete. Lunar repeats are left to the phone.
  async complete(item: Item, today: string, whole = false): Promise<CompleteOutcome> {
    const r = recurrence(item);
    if (!whole && repeats(r) && !desktopCanRepeat(r)) {
      return {
        result: { status: 'invalid', problems: ['Mark lunar-date repeats done on your phone, which works out their next date.'] },
        nextDue: null,
        xp: 'none',
      };
    }
    const next = whole || !repeats(r) ? null : nextFrom(r, item.due_date_ad, today);
    const changes: ItemEdit = next
      ? { due_date_ad: next.day, steps: item.steps.map((s) => ({ ...s, done: false })) }
      : { completed_at_ms: this.now() };
    const result = await this.update(item, changes);
    const xp = result.status === 'saved' ? await this.award(item) : 'none';
    return { result, nextDue: next?.day ?? null, xp };
  }

  reopen(item: Item): Promise<SaveResult<Item>> {
    return this.update(item, { completed_at_ms: null });
  }

  /// Skips this occurrence of a repeating item (stored as an exception, so
  /// the rule itself is unchanged) and moves to the next date.
  async skip(item: Item, today: string): Promise<SaveResult<Item> | null> {
    const r = recurrence(item);
    if (!repeats(r) || !desktopCanRepeat(r)) return null;
    const skipped = { ...r, exceptions: [...new Set([...r.exceptions, item.due_date_ad])] };
    const next = nextFrom(skipped, item.due_date_ad, today);
    if (!next) return null;
    return this.update(item, { repeat_exceptions: recurrenceColumns(skipped).repeat_exceptions, due_date_ad: next.day });
  }

  /// Moves an item to a new date and time (snooze); the rule is kept.
  snooze(item: Item, date: string, time: string | null): Promise<SaveResult<Item>> {
    return this.update(item, { due_date_ad: date, due_time: time, undated: false });
  }

  /// Soft delete. Final on the server, so callers hold it back for Undo.
  remove(item: Item): Promise<SaveResult<Item>> {
    return this.update(item, { deleted_at_ms: this.now() });
  }

  /// A copy with a fresh id, open, named "… (copy)" like the phone.
  duplicate(item: Item): Promise<SaveResult<Item>> {
    const { id: _id, owner_id: _o, revision: _r, server_updated_at: _s, created_at_ms: _c, updated_at_ms: _u, completed_at_ms: _d, deleted_at_ms: _x, ...rest } = item;
    return this.create({ ...(rest as ItemEdit), title: `${item.title} (copy)`.slice(0, 200), due_date_ad: item.due_date_ad, steps: item.steps.map((s) => ({ ...s, id: this.uuid(), done: false })) });
  }

  private async award(item: Item): Promise<CompleteOutcome['xp']> {
    const now = this.now();
    if (now - item.created_at_ms < minimumAgeMs) return 'tooSoon';
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    try {
      const today = await this.store.list('xp_ledger', { since: { column: 'awarded_at_ms', value: start.getTime() }, includeDeleted: true, orderBy: 'occurrence_key', from: 0, to: 999 });
      const key = `${item.id}|${item.due_date_ad}`;
      if (today.some((x) => x.occurrence_key === key)) return 'alreadyCounted';
      const earned = today.reduce((n, x) => n + Number(x.points ?? 0), 0);
      if (earned + xpPerCompletion > dailyXpCap) return 'dailyCap';
      const result = await this.store.insert('xp_ledger', {
        occurrence_key: key,
        task_id: item.id,
        kind: item.kind,
        points: xpPerCompletion,
        awarded_at_ms: now,
      });
      return result.kind === 'inserted' ? 'awarded' : 'alreadyCounted';
    } catch {
      // XP is a bonus; a failed write never undoes the completion.
      return 'none';
    }
  }

  // Notes -----------------------------------------------------------------

  async notesFor(parentId: string): Promise<Note[]> {
    const rows = (await this.store.list('item_notes', { eq: { parent_id: parentId }, from: 0, to: 499 })) as unknown as Note[];
    return rows.sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  async allNotes(): Promise<Note[]> {
    const out: Note[] = [];
    for (let from = 0; ; from += 1000) {
      const page = (await this.store.list('item_notes', { from, to: from + 999 })) as unknown as Note[];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  async addNote(parentType: Note['parent_type'], parentId: string, body: string): Promise<SaveResult<Note>> {
    const now = this.now();
    const row = { id: this.uuid(), parent_type: parentType, parent_id: parentId, body: body.trim(), created_at_ms: now, updated_at_ms: now, deleted_at_ms: null };
    const problems = validateNote(row);
    if (problems.length) return { status: 'invalid', problems };
    const result = await this.store.insert('item_notes', row);
    if (result.kind === 'inserted') return { status: 'saved', row: result.row as unknown as Note };
    const existing = (await this.store.fetchById('item_notes', row.id)) as Note | null;
    return existing ? { status: 'saved', row: existing } : { status: 'gone' };
  }

  editNote(note: Note, body: string): Promise<SaveResult<Note>> {
    return casUpdate<Note>(this.store, 'item_notes', note.id, note.revision, { body: body.trim() }, this.now(), validateNote);
  }

  removeNote(note: Note): Promise<SaveResult<Note>> {
    return casUpdate<Note>(this.store, 'item_notes', note.id, note.revision, { deleted_at_ms: this.now() }, this.now());
  }
}
