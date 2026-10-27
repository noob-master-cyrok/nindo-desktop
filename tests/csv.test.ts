import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { neutralize, parseImport, tasksToCsv, unneutralize } from '../src/domain/csv';
import { newTaskRow, type TaskRow } from '../src/domain/task';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function stored(overrides: Partial<TaskRow>): TaskRow {
  return {
    ...newTaskRow(uuid(), 1, { title: 'x', due_date_ad: '2026-10-27' }),
    owner_id: 'u',
    revision: 1,
    server_updated_at: '2026-10-27T08:00:00Z',
    ...overrides,
  } as TaskRow;
}

describe('formula injection', () => {
  it.each(['=SUM(A1)', '+1', '-2', '@cmd', '\tx'])('neutralizes %j', (value) => {
    expect(neutralize(value)).toBe(`'${value}`);
    expect(unneutralize(neutralize(value))).toBe(value);
  });

  it('leaves normal text', () => {
    expect(neutralize('Pay rent')).toBe('Pay rent');
    expect(unneutralize("'quoted")).toBe("'quoted");
  });

  it('exports dangerous titles safely', () => {
    const csv = tasksToCsv([stored({ title: '=HYPERLINK("http://x")' })]);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.data[0]!.title).toBe(`'=HYPERLINK("http://x")`);
  });
});

describe('CSV round trip', () => {
  it('exports and re-imports the editable fields', () => {
    const task = stored({
      title: '-Buy milk, eggs',
      due_time: '07:30',
      urgency: 2,
      category: 'Home',
      notes: 'line one\nline "two"',
      alert_offsets: '10,60',
      steps: [
        { id: 's1', title: 'Milk', done: true },
        { id: 's2', title: 'Eggs', done: false },
      ],
    });
    const { rows, fileProblems } = parseImport(tasksToCsv([task]), 99, uuid);
    expect(fileProblems).toEqual([]);
    expect(rows).toHaveLength(1);
    const imported = rows[0]!.task!;
    expect(imported.id).not.toBe(task.id);
    expect(imported).toMatchObject({
      title: '-Buy milk, eggs',
      due_date_ad: '2026-10-27',
      due_time: '07:30',
      urgency: 2,
      category: 'Home',
      notes: 'line one\nline "two"',
      alert_offsets: '10,60',
      created_at_ms: 99,
      updated_at_ms: 99,
    });
    expect(imported.steps.map((s) => [s.title, s.done])).toEqual([
      ['Milk', true],
      ['Eggs', false],
    ]);
    expect(imported.steps[0]!.id).not.toBe('s1');
  });
});

describe('CSV import validation', () => {
  it('needs a title column', () => {
    expect(parseImport('name\nx', 1, uuid).fileProblems).toEqual(['The file needs a "title" column.']);
  });

  it('reports problems per row and keeps valid rows', () => {
    const csv = [
      'Title,due_date,due_time,urgency,undated',
      'Good,2026-11-01,09:00,Critical,',
      ',2026-11-01,,,',
      'Bad date,2026-13-01,,,',
      'Bad time,2026-11-01,9am,,',
      'Bad urgency,2026-11-01,,7,',
      'No date,,,,',
      'Undated,,,,true',
    ].join('\n');
    const { rows } = parseImport(csv, 5, uuid, '2026-10-27');
    expect(rows.map((r) => [r.line, r.problems.length > 0])).toEqual([
      [2, false],
      [3, true],
      [4, true],
      [5, true],
      [6, true],
      [7, true],
      [8, false],
    ]);
    expect(rows[0]!.task!.urgency).toBe(3);
    expect(rows[6]!.task).toMatchObject({ undated: true, due_date_ad: '2026-10-27' });
  });

  it('skips blank lines and a byte-order mark', () => {
    const { rows } = parseImport('﻿title,due_date\nA,2026-10-27\n\n,\n', 1, uuid);
    expect(rows).toHaveLength(1);
  });
});
