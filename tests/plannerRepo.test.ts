import { beforeEach, describe, expect, it } from 'vitest';
import { PlannerRepo } from '../src/data/plannerRepo';
import { buildPatch, diffFields, nextUpdatedAt } from '../src/data/writeRules';
import { newTask, type Activity, type PlannerTask } from '../src/domain/planner';
import { FakeStore } from './fakeStore';

const ID = 'task-1';

function phoneTask(overrides: Partial<PlannerTask> = {}): Record<string, unknown> {
  return {
    ...newTask(ID, 1_000, { title: 'Ship desktop', labels: 'web,sync', priority: 3, project_id: 'p1' }),
    future_column: 'kept',
    ...overrides,
  };
}

describe('write rules', () => {
  it('never goes behind the row edit time', () => {
    expect(nextUpdatedAt(5_000, 1_000)).toBe(5_000);
    expect(nextUpdatedAt(1_000, 5_000)).toBe(5_001);
  });

  it('keeps unknown fields and drops server-owned ones', () => {
    const fresh = { id: 'x', owner_id: 'u', revision: 9, server_updated_at: 't', updated_at_ms: 10, a: 1, b: 'keep' };
    expect(buildPatch(fresh, { a: 2 }, 5)).toEqual({ a: 2, b: 'keep', updated_at_ms: 11 });
  });

  it('diffs by value', () => {
    expect(diffFields({ title: 'a', labels: 'x' }, { title: 'a', labels: 'y' })).toEqual({ labels: 'y' });
  });
});

describe('PlannerRepo', () => {
  let store: FakeStore;
  let clock: number;
  let n: number;
  let repo: PlannerRepo;
  const history = () =>
    [...store.tables.planner_activity.values()].map((a) => `${(a as unknown as Activity).kind}:${(a as unknown as Activity).body}`);

  beforeEach(() => {
    store = new FakeStore();
    clock = 50_000;
    n = 0;
    repo = new PlannerRepo({ store, now: () => clock, uuid: () => `id-${++n}` });
  });

  it('updates only edited fields, keeps the rest, and logs history', async () => {
    const seen = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    const result = await repo.update(seen, { title: 'Ship it', priority: 4 });
    expect(result.status).toBe('saved');
    const row = (result as { row: PlannerTask }).row;
    expect(row).toMatchObject({ title: 'Ship it', priority: 4, labels: 'web,sync', project_id: 'p1', future_column: 'kept', updated_at_ms: 50_000 });
    expect(history()).toEqual(['priority:urgent']);
  });

  it('keeps completed time in step with the status', async () => {
    let task = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    task = ((await repo.setStatus(task, 'done')) as { row: PlannerTask }).row;
    expect(task.completed_at_ms).toBe(50_000);
    clock = 60_000;
    task = ((await repo.setStatus(task, 'cancelled')) as { row: PlannerTask }).row;
    expect(task.completed_at_ms).toBe(50_000);
    task = ((await repo.setStatus(task, 'doing')) as { row: PlannerTask }).row;
    expect(task.completed_at_ms).toBeNull();
    expect(history()).toEqual(['status:done', 'status:cancelled', 'status:doing']);
  });

  it('reports a conflict instead of overwriting a phone edit', async () => {
    const seen = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    store.phoneWrite('planner_tasks', ID, { title: 'Phone title', updated_at_ms: 40_000 });
    const writes = store.writes;
    const result = await repo.update(seen, { description: 'Mine' });
    expect(result.status).toBe('conflict');
    expect(store.writes).toBe(writes);
    if (result.status !== 'conflict') return;
    expect(result.current.title).toBe('Phone title');
    const again = await repo.update(result.current, result.mine);
    expect((again as { row: PlannerTask }).row).toMatchObject({ title: 'Phone title', description: 'Mine' });
  });

  it('reports a conflict when the phone writes between read and save', async () => {
    const seen = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    const real = store.updateIfRevision.bind(store);
    store.updateIfRevision = async (table, id, revision, values) => {
      store.phoneWrite('planner_tasks', ID, { title: 'Raced', updated_at_ms: 49_000 });
      return real(table, id, revision, values);
    };
    expect((await repo.update(seen, { title: 'Mine' })).status).toBe('conflict');
    expect(store.tables.planner_tasks.get(ID)!.title).toBe('Raced');
  });

  it('uses old edit time + 1 when this clock is behind', async () => {
    const seen = store.seed('planner_tasks', phoneTask({ updated_at_ms: 90_000 })) as unknown as PlannerTask;
    expect(((await repo.update(seen, { critical: true })) as { row: PlannerTask }).row.updated_at_ms).toBe(90_001);
  });

  it('refuses invalid values before writing', async () => {
    const seen = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    const result = await repo.update(seen, { title: ' ', start_date: '2026-11-02', due_date: '2026-11-01' });
    expect(result.status).toBe('invalid');
    expect(store.writes).toBe(0);
  });

  it('creates a task at the end of its status, with history', async () => {
    const siblings = [phoneTask({ sort_order: 7 }), phoneTask({ id: 'x', status: 'doing', sort_order: 99 })] as unknown as PlannerTask[];
    const result = await repo.create({ title: ' New ', priority: 2 }, siblings);
    expect((result as { row: PlannerTask }).row).toMatchObject({
      id: 'id-1',
      title: 'New',
      status: 'todo',
      sort_order: 8,
      owner_id: 'user-a',
      created_at_ms: 50_000,
      completed_at_ms: null,
    });
    expect(history()).toEqual(['created:']);
  });

  it('sub-tasks: create, tick, delete with the parent', async () => {
    const parent = store.seed('planner_tasks', phoneTask()) as unknown as PlannerTask;
    const sub = ((await repo.create({ title: 'Write tests', parent_id: ID })) as { row: PlannerTask }).row;
    expect(sub.parent_id).toBe(ID);
    const ticked = ((await repo.toggleSubtask(sub)) as { row: PlannerTask }).row;
    expect(ticked.status).toBe('done');
    // Sub-tasks keep no history, like the phone.
    expect(history()).toEqual([]);

    clock = 70_000;
    await repo.remove(parent, [ticked]);
    expect(store.tables.planner_tasks.get(ID)!.deleted_at_ms).toBe(70_000);
    expect(store.tables.planner_tasks.get(sub.id)!.deleted_at_ms).toBe(70_000);
    expect((await repo.load()).tasks).toEqual([]);
  });

  it('links and comments', async () => {
    expect((await repo.addLink(ID, 'not a url', '')).status).toBe('invalid');
    const link = await repo.addLink(ID, 'https://example.test/spec', 'Spec');
    expect(link.status).toBe('saved');
    await repo.comment(ID, '  Looks good ');
    let details = await repo.details(ID);
    expect(details.links.map((l) => l.title)).toEqual(['Spec']);
    expect(details.activity.map((a) => `${a.kind}:${a.body}`)).toEqual(['link:Spec', 'comment:Looks good']);

    await repo.removeLink((link as { row: (typeof details.links)[0] }).row);
    details = await repo.details(ID);
    expect(details.links).toEqual([]);
  });

  it('projects', async () => {
    expect((await repo.createProject('  ', 1, [])).status).toBe('invalid');
    const project = await repo.createProject('Work', 2, []);
    expect(project.status).toBe('saved');
    expect((await repo.load()).projects.map((p) => p.name)).toEqual(['Work']);
  });

  it('cannot see or change another account', async () => {
    store.seed('planner_tasks', phoneTask(), 'user-b');
    expect(await repo.get(ID)).toBeNull();
    expect((await repo.load()).tasks).toEqual([]);
    expect((await repo.update({ id: ID, revision: 101, parent_id: null }, { title: 'Hijack' })).status).toBe('gone');
    expect(store.tables.planner_tasks.get(ID)!.title).toBe('Ship desktop');
  });

  it('a duplicate create reads back the saved row', async () => {
    repo = new PlannerRepo({ store, now: () => clock, uuid: () => 'same' });
    await repo.create({ title: 'Once' });
    expect((await repo.create({ title: 'Once' })).status).toBe('saved');
    expect(store.tables.planner_tasks.size).toBe(1);
  });
});
