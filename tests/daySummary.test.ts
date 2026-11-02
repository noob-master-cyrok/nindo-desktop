import { beforeEach, describe, expect, it } from 'vitest';
import { dayNote, noteDays, saveDayNote } from '../src/data/dayNotes';
import { daySummary, inScope, rangeSummary, reportForClaude, suggestedPoints, summaryText } from '../src/domain/daySummary';
import type { PlannerTask, Project } from '../src/domain/planner';
import type { Session, TimeData } from '../src/domain/time';

const day = '2026-11-02';
const at = (h: number, m = 0, d = 2) => new Date(2026, 10, d, h, m).getTime();

const task = (id: string, extra: Partial<PlannerTask> = {}): PlannerTask =>
  ({ id, parent_id: null, project_id: null, title: id, status: 'todo', sort_order: 0, completed_at_ms: null, deleted_at_ms: null, ...extra }) as PlannerTask;

let n = 0;
const session = (task_id: string, start: number, minutes: number, kind = 'focus'): Session =>
  ({ id: `s${++n}`, task_id, kind, started_at_ms: start, minutes, deleted_at_ms: null }) as Session;

const projects = [
  { id: 'work', name: 'Work', color: 3 },
  { id: 'study', name: 'Study', color: 5 },
] as Project[];

function data(extra: Partial<TimeData> = {}): TimeData {
  return { sessions: [], breaks: [], runs: [], attendance: [], ...extra };
}

describe('day summary', () => {
  it('lists tasks finished that day, oldest first, without subtasks or daily planning', () => {
    const tasks = [
      task('deck', { status: 'done', completed_at_ms: at(15) }),
      task('invoice', { status: 'done', completed_at_ms: at(10) }),
      task('old', { status: 'done', completed_at_ms: at(10, 0, 1) }),
      task('sub', { parent_id: 'deck', status: 'done', completed_at_ms: at(11) }),
      task(`daily-planning-${day}`, { status: 'done', completed_at_ms: at(9) }),
    ];
    const s = daySummary(day, tasks, null, day);
    expect(s.done.map((t) => t.id)).toEqual(['invoice', 'deck']);
  });

  it('adds time per project, counting a subtask under its parent and overlaps once', () => {
    const tasks = [task('deck', { project_id: 'work', status: 'doing' }), task('sub', { parent_id: 'deck', project_id: 'work' }), task('read', { project_id: 'study' })];
    const time = data({
      sessions: [session('deck', at(9), 60), session('sub', at(9, 30), 60), session('read', at(14), 30, 'manual'), session('read', at(9, 0, 1), 90)],
    });
    const s = daySummary(day, tasks, time, day);
    // 9:00-10:30 of timed work counts once; 30 min by hand on top.
    expect(s.workedMinutes).toBe(120);
    expect(s.byProject).toEqual([
      { projectId: 'work', minutes: 90 },
      { projectId: 'study', minutes: 30 },
    ]);
    expect(s.inHand.map((t) => t.id)).toEqual(['deck', 'read']);
  });

  it('shows in-progress tasks only on today, and worked-on tasks on any day', () => {
    const tasks = [task('doing', { status: 'doing' }), task('worked')];
    const time = data({ sessions: [session('worked', at(9, 0, 1), 20)] });
    expect(daySummary('2026-11-01', tasks, time, day).inHand.map((t) => t.id)).toEqual(['worked']);
    expect(daySummary(day, tasks, time, day).inHand.map((t) => t.id)).toEqual(['doing']);
  });

  it('reads breaks and attendance for the day', () => {
    const time = data({
      runs: [{ id: 'r', break_id: 'b', started_at_ms: at(12), ended_at_ms: at(12, 25), deleted_at_ms: null } as TimeData['runs'][number]],
      attendance: [{ id: day, check_in_ms: at(9), check_out_ms: at(17), note: '', edited: false, deleted_at_ms: null } as TimeData['attendance'][number]],
    });
    const s = daySummary(day, [], time, day);
    expect(s.breakMinutes).toBe(25);
    expect([s.checkInMs, s.checkOutMs]).toEqual([at(9), at(17)]);
  });
});

describe('points and copied text', () => {
  const tasks = [task('Send the invoice', { status: 'done', completed_at_ms: at(10), project_id: 'work' }), task('Client deck', { status: 'doing', project_id: 'work' })];
  const time = data({ sessions: [session('Client deck', at(9), 45)] });
  const s = daySummary(day, tasks, time, day);

  it('drafts points from the data', () => {
    expect(suggestedPoints(s, projects)).toEqual(['Finished Send the invoice', 'Worked 45 min on Work', 'In progress: Client deck']);
  });

  it('copies the drafted points when there are no notes', () => {
    const text = summaryText(s, projects, '', 'Monday 2 November 2026', () => '9:00');
    expect(text).toBe('Monday 2 November 2026\nworked 45 min\n\n• Finished Send the invoice\n• Worked 45 min on Work\n• In progress: Client deck');
  });

  it('copies own points, with the done list after them', () => {
    const text = summaryText(s, projects, '- Deck draft shared\n\n• Waiting on budget', 'Mon', () => '9:00');
    expect(text).toBe('Mon\nworked 45 min\n\n• Deck draft shared\n• Waiting on budget\n\nDone\n• Send the invoice');
  });
});

describe('report scope', () => {
  const tasks = [
    task('deck', { project_id: 'work', labels: 'client', status: 'done', completed_at_ms: at(10) }),
    task('read', { project_id: 'study', status: 'doing' }),
    task('tap', { project_id: null, status: 'done', completed_at_ms: at(11) }),
  ];
  const time = data({ sessions: [session('deck', at(9), 60), session('read', at(9, 30), 60)] });

  it('keeps only picked projects, labels and tasks not left out', () => {
    expect(inScope(tasks[0]!, { projects: ['work'], labels: [], hidden: [] })).toBe(true);
    expect(inScope(tasks[2]!, { projects: [null], labels: [], hidden: [] })).toBe(true);
    expect(inScope(tasks[1]!, { projects: [], labels: ['client'], hidden: [] })).toBe(false);
    expect(inScope(tasks[0]!, { projects: [], labels: [], hidden: ['deck'] })).toBe(false);
  });

  it('drops what is out of scope from the lists and the time, but overlaps still count once', () => {
    const s = daySummary(day, tasks, time, day, { projects: ['work'], labels: [], hidden: [] });
    expect(s.done.map((t) => t.id)).toEqual(['deck']);
    expect(s.inHand).toEqual([]);
    // 9:00-9:30 alone, 9:30-10:00 shared with the study session.
    expect(s.workedMinutes).toBe(45);
    expect(s.byProject).toEqual([{ projectId: 'work', minutes: 45 }]);
    expect(s.touched.map((t) => t.id)).toEqual(['deck', 'tap', 'read']);
  });

  it('adds a week, with each day noted, for Claude', () => {
    const week = rangeSummary('2026-11-01', 7, tasks, time, day);
    expect(week.done.length).toBe(2);
    expect(week.workedMinutes).toBe(90);
    const text = reportForClaude(week, projects, { [day]: '• Deck shared', '2026-10-31': 'outside the week' }, 'Week of 1 November 2026', (d) => d);
    expect(text).toContain('Nindo report: Week of 1 November 2026');
    expect(text).toContain('- Work: 45 min');
    expect(text).toContain('- deck [Work; client], done 2026-11-02, 45 min');
    expect(text).toContain(`${day}:\n- Deck shared`);
    expect(text).not.toContain('outside the week');
    const narrow = reportForClaude(rangeSummary('2026-11-01', 7, tasks, time, day, { projects: [], labels: [], hidden: ['read'] }), projects, {}, 'W', (d) => d);
    expect(narrow).not.toContain('read');
  });
});

describe('day notes', () => {
  // Tests run in Node, which has no localStorage.
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('keeps one note per day and drops empty ones', () => {
    expect(saveDayNote(day, '• one')).toBe(true);
    saveDayNote('2026-11-01', 'older');
    expect(dayNote(day)).toBe('• one');
    expect(noteDays()).toEqual([day, '2026-11-01']);
    saveDayNote(day, '   ');
    expect(dayNote(day)).toBe('');
    expect(noteDays()).toEqual(['2026-11-01']);
  });
});
