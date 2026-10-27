import { beforeEach, describe, expect, it } from 'vitest';
import { NotesRepo, type NoteRow } from '../src/data/notesRepo';
import { FakeStore } from './fakeStore';

const TASK = '0b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e';
const NOTE = '1b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e';

describe('NotesRepo', () => {
  let store: FakeStore;
  let repo: NotesRepo;

  beforeEach(() => {
    store = new FakeStore();
    repo = new NotesRepo({ store, now: () => 10_000, uuid: () => NOTE });
  });

  it('adds, edits and soft-deletes a note on a task', async () => {
    const created = await repo.create(TASK, ' Bring the receipt ');
    expect(created.status).toBe('saved');
    let note = (created as { row: NoteRow }).row;
    expect(note).toMatchObject({ parent_type: 'task', parent_id: TASK, body: 'Bring the receipt' });

    note = ((await repo.update(note, 'Bring both receipts')) as { row: NoteRow }).row;
    expect(note.body).toBe('Bring both receipts');
    expect(note.updated_at_ms).toBe(10_001);

    await repo.remove(note);
    expect(await repo.forTask(TASK)).toEqual([]);
    expect(store.tables.item_notes.get(NOTE)!.deleted_at_ms).toBe(10_000);
  });

  it('reports a conflict when the phone edited the note', async () => {
    const note = ((await repo.create(TASK, 'First')) as { row: NoteRow }).row;
    store.phoneWrite('item_notes', NOTE, { body: 'Phone edit', updated_at_ms: 9_000 });
    const result = await repo.update(note, 'Desktop edit');
    expect(result.status).toBe('conflict');
    expect(store.tables.item_notes.get(NOTE)!.body).toBe('Phone edit');
  });

  it('refuses an empty note', async () => {
    expect((await repo.create(TASK, '   ')).status).toBe('invalid');
  });

  it('only lists notes for the task and account', async () => {
    store.seed('item_notes', { id: 'a', parent_type: 'task', parent_id: TASK, body: 'mine', created_at_ms: 1 });
    store.seed('item_notes', { id: 'b', parent_type: 'task', parent_id: 'other', body: 'other task', created_at_ms: 1 });
    store.seed('item_notes', { id: 'c', parent_type: 'task', parent_id: TASK, body: 'theirs', created_at_ms: 1 }, 'user-b');
    expect((await repo.forTask(TASK)).map((n) => n.body)).toEqual(['mine']);
  });
});
