import { beforeEach, describe, expect, it } from 'vitest';
import { ItemsRepo } from '../src/data/itemsRepo';
import { newItemRow, type Item } from '../src/domain/item';
import { search, type SearchDoc } from '../src/domain/search';
import { toIcs } from '../src/domain/ics';
import { FakeStore } from './fakeStore';

let store: FakeStore;
let repo: ItemsRepo;
let clock = 1_000_000;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

beforeEach(() => {
  store = new FakeStore();
  clock = 1_000_000;
  n = 0;
  repo = new ItemsRepo({ store, now: () => clock, uuid });
});

const seedItem = (fields: Partial<Item> = {}) =>
  store.seed('tasks', { ...newItemRow(uuid(), 0, { title: 'Pay rent', due_date_ad: '2026-10-01', kind: 'bill' }), ...fields }) as unknown as Item;

describe('items', () => {
  it('creates items the way the phone writes them', async () => {
    const r = await repo.create({ title: '  Call Ama ', due_date_ad: '2026-10-30', due_time: '18:00', kind: 'reminder' });
    expect(r.status).toBe('saved');
    if (r.status !== 'saved') return;
    expect(r.row.title).toBe('Call Ama');
    expect(r.row.alert_offsets).toBe('0');
    expect(r.row.date_system).toBe('AD');
    expect(await repo.create({ title: '', due_date_ad: '2026-02-30' })).toMatchObject({ status: 'invalid' });
  });

  it('completes a one-off and awards XP once', async () => {
    const item = seedItem();
    const out = await repo.complete(item, '2026-10-30');
    expect(out.result.status).toBe('saved');
    expect(out.xp).toBe('awarded');
    expect(store.tables.xp_ledger.get(`${item.id}|2026-10-01`)?.points).toBe(10);
  });

  it('moves a repeating item to its next date and unticks steps', async () => {
    const item = seedItem({ repeat_rule: 'monthAd', anchor_day: 1, anchor_month: 10, series_start: '2026-01-01', steps: [{ id: 's1', title: 'Transfer', done: true }] });
    const out = await repo.complete(item, '2026-10-30');
    expect(out.nextDue).toBe('2026-11-01');
    if (out.result.status !== 'saved') throw new Error('not saved');
    expect(out.result.row.completed_at_ms).toBeNull();
    expect(out.result.row.steps[0]!.done).toBe(false);
  });

  it('leaves lunar repeats to the phone', async () => {
    const out = await repo.complete(seedItem({ repeat_rule: 'tithi', date_system: 'TITHI', tithi_key: 'purnima' }), '2026-10-30');
    expect(out.result.status).toBe('invalid');
  });

  it('skips one occurrence as an exception', async () => {
    const item = seedItem({ repeat_rule: 'daily', series_start: '2026-10-29', due_date_ad: '2026-10-30' });
    const r = await repo.skip(item, '2026-10-30');
    expect(r).toMatchObject({ status: 'saved', row: { due_date_ad: '2026-10-31', repeat_exceptions: '2026-10-30' } });
  });

  it('keeps phone edits: a stale revision is a conflict', async () => {
    const item = seedItem();
    store.phoneWrite('tasks', item.id, { title: 'Pay rent (phone)', updated_at_ms: 5 });
    expect((await repo.update(item, { title: 'Desk' })).status).toBe('conflict');
  });

  it('adds, edits and deletes notes', async () => {
    const item = seedItem();
    const added = await repo.addNote('task', item.id, 'Paid half');
    if (added.status !== 'saved') throw new Error('not saved');
    expect((await repo.notesFor(item.id)).map((x) => x.body)).toEqual(['Paid half']);
    await repo.editNote(added.row, 'Paid all');
    const [note] = await repo.notesFor(item.id);
    await repo.removeNote(note!);
    expect(await repo.notesFor(item.id)).toEqual([]);
  });
});

describe('search', () => {
  const docs: SearchDoc[] = [
    { kind: 'item', id: 'a', title: 'Pay electricity bill', fields: [], day: '2026-11-01', done: false },
    { kind: 'task', id: 'b', title: 'Bill review', fields: [{ label: 'Description', text: 'pay the team' }], day: null, done: false },
    { kind: 'festival', id: 'c', title: 'Tihar', fields: [{ label: 'Nepali', text: 'तिहार' }], day: '2026-11-08', done: false },
  ];
  it('puts the whole phrase first, then partial matches', () => {
    const r = search(docs, 'pay bill', '2026-10-30');
    expect(r.matches).toEqual([]);
    expect(r.partial.map((h) => h.doc.id)).toEqual(['a', 'b']);
    expect(search(docs, 'तिहार', '2026-10-30').matches[0]!.where?.label).toBe('Nepali');
  });
});

describe('calendar file', () => {
  it('writes timed and all-day events', () => {
    const item = newItemRow('id-1', 0, { title: 'Dentist, 2nd floor', due_date_ad: '2026-11-02', due_time: '23:45' }) as Item;
    const ics = toIcs([{ item, date: '2026-11-02' }, { item: { ...item, due_time: null }, date: '2026-11-03' }], 0);
    expect(ics).toContain('DTSTART:20261102T234500');
    expect(ics).toContain('DTEND:20261103T001500');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261103');
    expect(ics).toContain('SUMMARY:Dentist\\, 2nd floor');
  });
});
