import type { InsertResult, ListQuery, Row, Store, Table } from '../src/data/store';

/// In-memory copy of the server rules (migration 0005): owner-only access, a
/// global revision sequence, stale writes ignored, duplicate ids refused.
export class FakeStore implements Store {
  readonly tables: Record<Table, Map<string, Row>> = {
    planner_projects: new Map(),
    planner_tasks: new Map(),
    planner_links: new Map(),
    planner_activity: new Map(),
    planner_sessions: new Map(),
    planner_breaks: new Map(),
    planner_break_runs: new Map(),
    planner_attendance: new Map(),
  };
  private sequence = 100;
  writes = 0;

  constructor(public userId = 'user-a') {}

  /// Puts a row straight in, as if another device had written it.
  seed(table: Table, row: Record<string, unknown>, owner = this.userId): Row {
    const stored = { ...row, owner_id: owner, revision: ++this.sequence, server_updated_at: 'now' } as unknown as Row;
    this.tables[table].set(stored.id, stored);
    return structuredClone(stored);
  }

  /// Writes as the phone does: whole-row upsert, no revision check.
  phoneWrite(table: Table, id: string, changes: Record<string, unknown>): Row {
    const old = this.tables[table].get(id)!;
    const next = { ...old, ...changes, revision: ++this.sequence } as Row;
    this.tables[table].set(id, next);
    return structuredClone(next);
  }

  private visible(table: Table, id: string): Row | undefined {
    const row = this.tables[table].get(id);
    return row && row.owner_id === this.userId ? row : undefined;
  }

  async fetchById(table: Table, id: string): Promise<Row | null> {
    const row = this.visible(table, id);
    return row ? structuredClone(row) : null;
  }

  async updateIfRevision(table: Table, id: string, revision: number, values: Record<string, unknown>): Promise<Row | null> {
    this.writes++;
    const old = this.visible(table, id);
    if (!old || old.revision !== revision) return null;
    if ('owner_id' in values && values.owner_id !== old.owner_id) throw new Error('owner_id cannot change');
    if (Number(values.updated_at_ms) < Number(old.updated_at_ms)) return null;
    const next = { ...old, ...values, revision: ++this.sequence, server_updated_at: 'now' } as Row;
    this.tables[table].set(id, next);
    return structuredClone(next);
  }

  async insert(table: Table, values: Record<string, unknown>): Promise<InsertResult> {
    this.writes++;
    const id = values.id as string;
    if (this.tables[table].has(id)) return { kind: 'duplicate' };
    const owner = (values.owner_id as string | undefined) ?? this.userId;
    if (owner !== this.userId) throw new Error('42501');
    const row = { ...values, owner_id: owner, revision: ++this.sequence, server_updated_at: 'now' } as unknown as Row;
    this.tables[table].set(id, row);
    return { kind: 'inserted', row: structuredClone(row) };
  }

  async list(table: Table, query: ListQuery): Promise<Row[]> {
    return [...this.tables[table].values()]
      .filter((r) => r.owner_id === this.userId)
      .filter((r) => query.includeDeleted || r.deleted_at_ms == null)
      .filter((r) => Object.entries(query.eq ?? {}).every(([k, v]) => r[k] === v))
      .filter((r) => !query.since || Number(r[query.since.column]) >= query.since.value)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(query.from, query.to + 1)
      .map((r) => structuredClone(r));
  }
}
