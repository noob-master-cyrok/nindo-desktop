import { describe, expect, it } from 'vitest';
import { buildReport, listProjects, listTasks, rangeOf, resolveProjects, type NindoData } from '../mcp/report';
import type { PlannerTask, Project } from '../src/domain/planner';
import type { Session } from '../src/domain/time';

const today = '2026-11-02';
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

const task = (id: string, extra: Partial<PlannerTask> = {}): PlannerTask =>
  ({ id, parent_id: null, project_id: null, title: id, description: '', labels: '', status: 'todo', priority: 0, due_date: null, sort_order: 0, completed_at_ms: null, deleted_at_ms: null, ...extra }) as PlannerTask;
const session = (id: string, task_id: string, start: number, minutes: number): Session => ({ id, task_id, kind: 'manual', started_at_ms: start, minutes, deleted_at_ms: null }) as Session;

const data: NindoData = {
  projects: [
    { id: 'p1', name: 'Re Projects', color: 6, archived: false, deleted_at_ms: null },
    { id: 'p2', name: 'Career', color: 1, archived: false, deleted_at_ms: null },
  ] as Project[],
  tasks: [
    task('t1', { title: 'Recruitment Static Campaign', project_id: 'p1', status: 'doing', labels: 'ads', due_date: '2026-11-03' }),
    task('t2', { title: 'N8N Lead Flow Setup', project_id: 'p1', status: 'done', completed_at_ms: at(2, 11) }),
    task('t3', { title: 'Personal Website Update', project_id: 'p2', status: 'todo', due_date: '2026-10-30' }),
    task('t4', { title: 'Old gone', project_id: 'p2', status: 'done', completed_at_ms: at(2, 9), deleted_at_ms: 5 }),
  ],
  time: { sessions: [session('s1', 't1', at(2, 9), 60), session('s2', 't3', at(1, 10), 30)], breaks: [], runs: [], attendance: [] },
};

describe('Nindo connector', () => {
  it('finds periods like the desktop', () => {
    expect(rangeOf('week', today)).toMatchObject({ from: '2026-11-01', count: 7 });
    expect(rangeOf('month', today)).toMatchObject({ from: '2026-11-01', count: 30, title: 'November 2026' });
  });

  it('matches project names in any case, and says which are unknown', () => {
    expect(resolveProjects(['re projects', 'No project', 'p2', 'Nope'], data.projects)).toEqual({ ids: ['p1', null, 'p2'], unknown: ['Nope'] });
    expect(buildReport(data, { period: 'day', projects: ['Nope'] }, today)).toContain('No project called "Nope"');
  });

  it('reports a week for one project, leaving out deleted tasks', () => {
    const r = buildReport(data, { period: 'week', projects: ['Re Projects'] }, today);
    expect(r).toContain('Worked: 1 h');
    expect(r).toContain('- N8N Lead Flow Setup [Re Projects]');
    expect(r).toContain('- Recruitment Static Campaign [Re Projects; ads], due Tue 3 Nov, 1 h');
    expect(r).not.toContain('Personal Website');
    expect(r).not.toContain('Old gone');
    expect(r).toContain('Report covers projects: Re Projects. Period 2026-11-01 to 2026-11-07');
  });

  it('includes the notes of the days in the period', () => {
    const r = buildReport({ ...data, notes: { [today]: '• Deck shared with the client', '2026-10-31': 'last week' } }, { period: 'week' }, today);
    expect(r).toContain('Mon 2 Nov:\n- Deck shared with the client');
    expect(r).not.toContain('last week');
  });

  it('leaves out tasks by title and filters by label', () => {
    expect(buildReport(data, { period: 'week', exclude_tasks: ['n8n lead flow setup'] }, today)).not.toContain('N8N');
    const ads = buildReport(data, { period: 'week', labels: ['ads'] }, today);
    expect(ads).toContain('Recruitment');
    expect(ads).not.toContain('Personal Website');
  });

  it('rejects a malformed date', () => {
    expect(buildReport(data, { period: 'day', date: '2/11/2026' }, today)).toContain('must look like');
  });

  it('lists tasks and projects', () => {
    const open = listTasks(data, { status: 'open' }, today);
    expect(open).toContain('2 task(s)');
    expect(open.split('\n')[1]).toBe('- Personal Website Update [To do; Career], due 2026-10-30 (overdue)');
    expect(listTasks(data, { project: 'career', query: 'website' }, today)).toContain('Personal Website Update');
    expect(listProjects(data)).toBe('Projects:\n- Re Projects: 1 open task(s)\n- Career: 1 open task(s)\n- No project (inbox)');
  });
});
