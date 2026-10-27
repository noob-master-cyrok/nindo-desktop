import { beforeEach, describe, expect, it } from 'vitest';
import { TasksRepo } from '../src/data/tasksRepo';
import { buildPatch, diffFields, nextUpdatedAt } from '../src/data/writeRules';
import { newTaskRow, type TaskRow } from '../src/domain/task';
import { FakeStore } from './fakeStore';

const ID = '0b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e';

function phoneTask(overrides: Partial<TaskRow> = {}): Record<string, unknown> {
  return {
    ...newTaskRow(ID, 1_000, { title: 'Pay rent', due_date_ad: '2026-10-27' }),
    ringtone: 'bell',
    tithi_region: 'NP',
    alert_offsets: '10,60',
    repeat_exceptions: '2026-11-01',
    steps: [
      { id: 'step-1', title: 'Withdraw cash', done: true },
      { id: 'step-2', title: 'Hand over', done: false },
    ],
    future_column: 'kept',
    ...overrides,
  };
}

describe('write rules', () => {
  it('never goes behind the row edit time', () => {
    expect(nextUpdatedAt(5_000, 1_000)).toBe(5_000);
    expect(nextUpdatedAt(1_000, 5_000)).toBe(5_001);
    expect(nextUpdatedAt(5_000, 5_000)).toBe(5_001);
  });

  it('keeps unknown fields and drops server-owned ones', () => {
    const fresh = { id: 'x', owner_id: 'u', revision: 9, server_updated_at: 't', updated_at_ms: 10, a: 1, ringtone: 'bell' };
    const patch = buildPatch(fresh, { a: 2 }, 5);
    expect(patch).toEqual({ a: 2, ringtone: 'bell', updated_at_ms: 11 });
  });

  it('diffs by value', () => {
    const base = { title: 'a', steps: [{ id: '1', title: 's', done: false }] };
    expect(diffFields(base, { title: 'a', steps: [{ id: '1', title: 's', done: false }] })).toEqual({});
    expect(diffFields(base, { title: 'b' })).toEqual({ title: 'b' });
  });
});

describe('TasksRepo', () => {
  let store: FakeStore;
  let clock: number;
  let repo: TasksRepo;

  beforeEach(() => {
    store = new FakeStore();
    clock = 50_000;
    repo = new TasksRepo({ store, now: () => clock, uuid: () => ID });
  });

  it('updates only the edited field and keeps everything else', async () => {
    const seen = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    const result = await repo.update(ID, seen.revision, { title: 'Pay rent today' });
    expect(result.status).toBe('saved');
    const row = (result as { row: TaskRow }).row;
    expect(row.title).toBe('Pay rent today');
    expect(row.ringtone).toBe('bell');
    expect(row.tithi_region).toBe('NP');
    expect(row.alert_offsets).toBe('10,60');
    expect(row.repeat_exceptions).toBe('2026-11-01');
    expect(row.future_column).toBe('kept');
    expect(row.steps).toEqual(seen.steps);
    expect(row.updated_at_ms).toBe(50_000);
    expect(row.revision).toBeGreaterThan(seen.revision);
  });

  it('keeps step ids when steps are edited', async () => {
    const seen = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    const steps = [
      { ...seen.steps[1]!, done: true },
      { ...seen.steps[0]! },
      { id: 'new-step', title: 'Get receipt', done: false },
    ];
    const result = await repo.update(ID, seen.revision, { steps });
    expect((result as { row: TaskRow }).row.steps.map((s) => s.id)).toEqual(['step-2', 'step-1', 'new-step']);
  });

  it('uses old edit time + 1 when this clock is behind', async () => {
    const seen = store.seed('tasks', phoneTask({ updated_at_ms: 90_000 })) as unknown as TaskRow;
    const result = await repo.update(ID, seen.revision, { urgency: 3 });
    expect((result as { row: TaskRow }).row.updated_at_ms).toBe(90_001);
  });

  it('reports a conflict instead of overwriting a phone edit', async () => {
    const seen = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    store.phoneWrite('tasks', ID, { title: 'Changed on phone', updated_at_ms: 40_000 });
    const writesBefore = store.writes;
    const result = await repo.update(ID, seen.revision, { title: 'Desktop title' });
    expect(result.status).toBe('conflict');
    if (result.status !== 'conflict') return;
    expect(result.current.title).toBe('Changed on phone');
    expect(result.mine).toEqual({ title: 'Desktop title' });
    expect(store.writes).toBe(writesBefore);
    expect(store.tables.tasks.get(ID)!.title).toBe('Changed on phone');

    // Re-applying on top of the current version saves.
    const again = await repo.update(ID, result.current.revision, result.mine);
    expect(again.status).toBe('saved');
  });

  it('reports a conflict when the phone writes between read and save', async () => {
    const seen = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    const realUpdate = store.updateIfRevision.bind(store);
    store.updateIfRevision = async (table, id, revision, values) => {
      store.phoneWrite('tasks', ID, { title: 'Raced', updated_at_ms: 49_000 });
      return realUpdate(table, id, revision, values);
    };
    const result = await repo.update(ID, seen.revision, { title: 'Mine' });
    expect(result.status).toBe('conflict');
    expect(store.tables.tasks.get(ID)!.title).toBe('Raced');
  });

  it('cannot change a deleted task', async () => {
    const seen = store.seed('tasks', phoneTask({ deleted_at_ms: 2_000 })) as unknown as TaskRow;
    expect((await repo.update(ID, seen.revision, { title: 'Back' })).status).toBe('gone');
  });

  it('cannot see or change another account', async () => {
    store.seed('tasks', phoneTask(), 'user-b');
    expect(await repo.get(ID)).toBeNull();
    expect(await repo.listAll()).toEqual([]);
    expect((await repo.update(ID, 101, { title: 'Hijack' })).status).toBe('gone');
    expect(store.tables.tasks.get(ID)!.title).toBe('Pay rent');
  });

  it('completes, reopens and soft-deletes', async () => {
    let task = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    const done = await repo.complete(task);
    expect(done.status).toBe('saved');
    task = (done as { row: TaskRow }).row;
    expect(task.completed_at_ms).toBe(50_000);

    clock = 60_000;
    task = ((await repo.reopen(task)) as { row: TaskRow }).row;
    expect(task.completed_at_ms).toBeNull();

    clock = 70_000;
    const removed = await repo.remove(task);
    expect((removed as { row: TaskRow }).row.deleted_at_ms).toBe(70_000);
    expect(store.tables.tasks.has(ID)).toBe(true);
    expect(await repo.listAll()).toEqual([]);
  });

  it('will not complete a repeating task', async () => {
    const task = store.seed('tasks', phoneTask({ repeat_rule: 'weekly' })) as unknown as TaskRow;
    const result = await repo.complete(task);
    expect(result.status).toBe('invalid');
    expect(store.tables.tasks.get(ID)!.completed_at_ms).toBeNull();
  });

  it('treats imported events as read-only', async () => {
    const task = store.seed('tasks', phoneTask({ kind: 'event' })) as unknown as TaskRow;
    expect((await repo.update(ID, task.revision, { title: 'x' })).status).toBe('invalid');
    expect((await repo.remove(task)).status).toBe('invalid');
  });

  it('refuses invalid values before writing', async () => {
    const task = store.seed('tasks', phoneTask()) as unknown as TaskRow;
    const result = await repo.update(ID, task.revision, { title: ' ', due_time: '25:00' });
    expect(result.status).toBe('invalid');
    expect(store.writes).toBe(0);
  });

  it('creates with a client id and phone defaults', async () => {
    const result = await repo.create({ title: ' New ', due_date_ad: '2026-10-28', urgency: 2 });
    expect(result.status).toBe('saved');
    const row = (result as { row: TaskRow }).row;
    expect(row).toMatchObject({
      id: ID,
      title: 'New',
      owner_id: 'user-a',
      time_zone_policy: 'floating_local',
      date_system: 'AD',
      kind: 'task',
      created_at_ms: 50_000,
      updated_at_ms: 50_000,
    });
  });

  it('treats a duplicate create as success', async () => {
    await repo.create({ title: 'Once', due_date_ad: '2026-10-28' });
    const second = await repo.create({ title: 'Once', due_date_ad: '2026-10-28' });
    expect(second.status).toBe('saved');
    expect(store.tables.tasks.size).toBe(1);
  });

  it('reads every page', async () => {
    for (let i = 0; i < 5; i++) {
      store.seed('tasks', { ...phoneTask(), id: `00000000-0000-4000-8000-00000000000${i}` });
    }
    expect((await repo.listAll(2)).length).toBe(5);
  });
});
