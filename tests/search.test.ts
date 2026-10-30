import { describe, expect, it } from 'vitest';
import { newItemRow, type Item } from '../src/domain/item';
import { buildSearchDocs, highlightRanges, search, searchSnippet, searchTerms, type FieldKind, type SearchDoc, type SearchHit } from '../src/domain/search';
import type { Festival } from '../src/domain/calendar';
import type { PlannerTask } from '../src/domain/planner';

// The same cases as the phone's test/search_test.dart.
const today = '2026-09-27';

const doc = (id: string, title: string, { fields = {}, day = null, done = false }: { fields?: Partial<Record<FieldKind, string>>; day?: string | null; done?: boolean } = {}): SearchDoc => ({
  kind: 'item',
  id,
  title,
  day,
  done,
  label: 'Reminder',
  fields: Object.entries(fields).map(([kind, text]) => ({ kind: kind as FieldKind, text: text! })),
});
const ids = (hits: SearchHit[]) => hits.map((h) => h.doc.id);

describe('matching', () => {
  const docs = [
    doc('title', 'Change motor oil', { day: '2026-10-02' }),
    doc('notes', 'Bike service', { fields: { notes: 'Ask them to top up the MOTOR  OIL' }, day: '2026-10-01' }),
    doc('both', 'Oil for the motorbike', { day: '2026-09-30' }),
    doc('oil', 'Buy cooking oil', { day: '2026-09-28' }),
    doc('step', 'Weekend jobs', { fields: { step: 'Wash the motor' } }),
    doc('none', 'Pay rent'),
  ];

  it('puts the whole phrase first, wherever it is and in any case', () => {
    const r = search(docs, 'motor oil', today);
    expect(ids(r.full)).toEqual(['title', 'notes']);
    expect(r.full[0]!.inTitle).toBe(true);
    expect(r.full[0]!.detail).toBeNull();
    expect(r.full[1]!.detail!.kind).toBe('notes');
  });

  it('follows with things holding some of the words, more words first', () => {
    const r = search(docs, 'motor oil', today);
    expect(ids(r.partial)).toEqual(['both', 'oil', 'step']);
    expect(r.partial[0]!.matchedTerms).toBe(2);
    expect(r.partial[2]!.detail!.kind).toBe('step');
    expect(ids([...r.full, ...r.partial])).not.toContain('none');
  });

  it('ignores extra spaces and repeated words', () => {
    const a = search(docs, '  motor   oil ', today);
    expect(a.terms).toEqual(['motor', 'oil']);
    expect(searchTerms('oil motor oil')).toEqual(['motor', 'oil']);
    expect(ids(a.full)).toEqual(['title', 'notes']);
  });

  it('has no partial group for one word', () => {
    const r = search(docs, 'motor', today);
    expect(r.partial).toEqual([]);
    expect(r.full).toHaveLength(4);
  });

  it('finds nothing for a blank query', () => {
    expect(search(docs, '   ', today).full).toEqual([]);
    expect(search(docs, '', today).terms).toEqual([]);
  });

  it('orders title matches, open before done, upcoming soonest, then the most recent past', () => {
    const r = search(
      [
        doc('past-far', 'Gas bill', { day: '2026-08-01' }),
        doc('past-near', 'Water bill', { day: '2026-09-20' }),
        doc('later', 'Phone bill', { day: '2026-11-01' }),
        doc('soon', 'Internet bill', { day: '2026-09-29' }),
        doc('undated', 'Old bill'),
        doc('done', 'Paid bill', { day: '2026-09-28', done: true }),
        doc('note', 'Shopping', { fields: { note: 'bill' } }),
      ],
      'BILL',
      today,
    );
    expect(ids(r.full)).toEqual(['soon', 'later', 'past-near', 'past-far', 'undated', 'done', 'note']);
  });

  it('finds Nepali text', () => {
    expect(ids(search([doc('ne', 'मोटरको तेल फेर्ने')], 'तेल', today).full)).toEqual(['ne']);
  });
});

describe('highlights and snippets', () => {
  it('marks every occurrence and merges overlaps', () => {
    expect(highlightRanges('Motor oil, motorbike oil', ['motor', 'oil'])).toEqual([
      [0, 5],
      [6, 9],
      [11, 16],
      [21, 24],
    ]);
    expect(highlightRanges('aaaa', ['aa', 'aaa'])).toEqual([[0, 4]]);
  });

  it('cuts a long field around the first match, on word breaks', () => {
    const text = 'Before the trip remember to check the tyres, the brakes and the chain, then ask the mechanic to change the motor oil and the air filter before Dashain.';
    const s = searchSnippet(text, ['motor'], 50);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('motor oil');
    expect(s.length).toBeLessThanOrEqual(52);
    expect(searchSnippet('Short\nnote', ['note'])).toBe('Short note');
  });
});

describe('what is searched', () => {
  const item = (fields: Partial<Item>) => ({ ...newItemRow(fields.id ?? 'i1', 0, { title: 'Item', due_date_ad: '2026-10-01' }), ...fields }) as Item;
  const task = (fields: Partial<PlannerTask>) =>
    ({ id: 't', project_id: null, parent_id: null, title: 'Task', description: '', status: 'todo', priority: 0, labels: '', start_date: null, due_date: null, sort_order: 0, estimate_minutes: null, critical: false, created_at_ms: 1, updated_at_ms: 1, completed_at_ms: null, deleted_at_ms: null, ...fields }) as PlannerTask;
  const fest = (fields: Partial<Festival>): Festival => ({ id: 'f', iso: '2026-10-21', nameEn: 'Laxmi Puja', nameNe: 'लक्ष्मी पूजा', holiday: true, kind: 'kmc', source: 'kmc', noteId: 'f', ...fields });
  const docs = buildSearchDocs({
    items: [
      item({ id: 'a', title: 'Dentist', notes: 'Bring the x-ray', steps: [{ id: 's', title: 'Call to confirm', done: false }], category: 'health' }),
      item({ id: 'gone', title: 'Dentist old', deleted_at_ms: 5 }),
    ],
    notes: [
      { parent_type: 'task', parent_id: 'a', body: 'Moved to Sunday', deleted_at_ms: null },
      { parent_type: 'task', parent_id: 'a', body: 'Deleted note', deleted_at_ms: 9 },
      { parent_type: 'festival', parent_id: 'f', body: 'Buy diyo', deleted_at_ms: null },
    ],
    tasks: [task({ id: 'p', title: 'Prepare deck', labels: 'client,slides', status: 'cancelled' }), task({ id: 'sub', parent_id: 'p', title: 'Collect numbers' })],
    festivals: [fest({}), fest({ id: 'named', noteId: null, nameEn: 'Ekadashi', nameNe: 'एकादशी' })],
  });
  const find = (q: string) => [...search(docs, q, today).full].map((h) => [h.doc.id, h.detail?.kind ?? 'title']);

  it("searches an item's description, steps, live notes and category name", () => {
    expect(find('x-ray')).toEqual([['a', 'notes']]);
    expect(find('confirm')).toEqual([['a', 'step']]);
    expect(find('sunday')).toEqual([['a', 'note']]);
    expect(find('health')).toEqual([['a', 'category']]);
    expect(find('deleted')).toEqual([]);
    expect(find('dentist')).toEqual([['a', 'title']]);
  });

  it('searches a task with its sub-tasks and each label; sub-tasks are not results of their own', () => {
    expect(find('collect')).toEqual([['p', 'step']]);
    expect(find('slides')).toEqual([['p', 'category']]);
    expect(docs.find((d) => d.id === 'p')!.done).toBe(true);
  });

  it("searches the city calendar's festivals in both languages with their notes, like the phone", () => {
    expect(find('लक्ष्मी')).toEqual([['f@2026-10-21', 'otherName']]);
    expect(find('diyo')).toEqual([['f@2026-10-21', 'note']]);
    expect(find('ekadashi')).toEqual([]);
    expect(docs.find((d) => d.kind === 'festival')!.label).toBe('Holiday');
  });
});
