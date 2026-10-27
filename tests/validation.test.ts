import { describe, expect, it } from 'vitest';
import { isRepeating, newTaskRow, normalizeOffsets, validateTask } from '../src/domain/task';
import { validateNote } from '../src/data/notesRepo';

const ID = '0b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e';
const base = () => newTaskRow(ID, 1, { title: 'A task', due_date_ad: '2026-10-27' }) as Record<string, unknown>;
const bad = (changes: Record<string, unknown>) => validateTask({ ...base(), ...changes });

describe('task constraints (migrations 0001–0004)', () => {
  it('accepts a phone-shaped row', () => {
    expect(validateTask(base())).toEqual([]);
  });

  it.each([
    ['empty title', { title: '' }],
    ['blank title', { title: '   ' }],
    ['long title', { title: 'x'.repeat(201) }],
    ['long notes', { notes: 'x'.repeat(4001) }],
    ['long category', { category: 'x'.repeat(41) }],
    ['bad date', { due_date_ad: '2026-02-30' }],
    ['date format', { due_date_ad: '27/10/2026' }],
    ['date system', { date_system: 'NS' }],
    ['time format', { due_time: '9:30' }],
    ['hour 24', { due_time: '24:00' }],
    ['urgency low', { urgency: -1 }],
    ['urgency high', { urgency: 4 }],
    ['interval', { repeat_interval: 100 }],
    ['count', { repeat_count: 501 }],
    ['rule', { repeat_rule: 'hourly' }],
    ['missing policy', { missing_date_policy: 'drop' }],
    ['alert style', { alert_style: 'siren' }],
    ['tithi without key', { repeat_rule: 'tithi', tithi_region: 'NP', tithi_source: 'x' }],
    ['bad tithi key', { tithi_key: 'ashtami' }],
    ['yearTithi without anchor', { repeat_rule: 'yearTithi', tithi_region: 'NP', tithi_source: 'x' }],
    ['yearTithi day 31', { repeat_rule: 'yearTithi', anchor_month: 1, anchor_day: 31, tithi_region: 'NP', tithi_source: 'x' }],
    ['steps not array', { steps: {} }],
    ['step shape', { steps: [{ id: 'a', title: '', done: false }] }],
    ['alert offsets', { alert_offsets: '10,abc' }],
  ])('rejects %s', (_, changes) => {
    expect(bad(changes).length).toBeGreaterThan(0);
  });

  it.each([
    ['max title', { title: 'x'.repeat(200) }],
    ['valid time', { due_time: '23:59' }],
    ['all urgencies', { urgency: 3 }],
    ['tithi rule', { repeat_rule: 'tithi', tithi_key: 'purnima', tithi_region: 'NP', tithi_source: 'v1' }],
    ['yearTithi', { repeat_rule: 'yearTithi', anchor_month: 6, anchor_day: 4, tithi_region: 'NP', tithi_source: 'v1' }],
    ['leap day', { due_date_ad: '2028-02-29' }],
  ])('accepts %s', (_, changes) => {
    expect(bad(changes)).toEqual([]);
  });

  it('normalizes alert offsets like the phone', () => {
    expect(normalizeOffsets('60, 10,10')).toBe('10,60');
    expect(normalizeOffsets('')).toBe('');
    expect(normalizeOffsets('-5')).toBeNull();
  });

  it('knows repeating tasks', () => {
    expect(isRepeating({ repeat_rule: 'daily', undated: false })).toBe(true);
    expect(isRepeating({ repeat_rule: 'daily', undated: true })).toBe(false);
    expect(isRepeating({ repeat_rule: 'none', undated: false })).toBe(false);
  });
});

describe('note constraints', () => {
  const note = { id: ID, parent_type: 'task', parent_id: ID, body: 'Hi', created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null };
  it('accepts a note', () => expect(validateNote(note)).toEqual([]));
  it('rejects empty body', () => expect(validateNote({ ...note, body: ' ' }).length).toBe(1));
  it('rejects long body', () => expect(validateNote({ ...note, body: 'x'.repeat(4001) }).length).toBe(1));
  it('rejects bad parent type', () => expect(validateNote({ ...note, parent_type: 'event' }).length).toBe(1));
  it('rejects long parent id', () => expect(validateNote({ ...note, parent_id: 'x'.repeat(81) }).length).toBe(1));
});
