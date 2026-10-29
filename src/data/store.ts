/// The narrow database surface the repositories need. The Supabase version
/// lives in `supabaseStore.ts`; tests use an in-memory fake that copies the
/// server triggers.
export type Table = 'planner_projects' | 'planner_tasks' | 'planner_links' | 'planner_activity';

export type Row = Record<string, unknown> & { id: string; revision: number };

export type InsertResult = { kind: 'inserted'; row: Row } | { kind: 'duplicate' };

export interface ListQuery {
  /// Only rows whose columns equal these values (for example a task's links).
  eq?: Record<string, string>;
  /// Only rows whose [column] is at least [value] (for example today's history).
  since?: { column: string; value: number };
  includeDeleted?: boolean;
  from: number;
  to: number;
}

export interface Store {
  fetchById(table: Table, id: string): Promise<Row | null>;
  /// Compare-and-swap: updates only while the row still has [revision].
  /// Returns the new row, or null when nothing changed (someone else wrote
  /// first, or the server ignored the write as stale).
  updateIfRevision(table: Table, id: string, revision: number, values: Record<string, unknown>): Promise<Row | null>;
  insert(table: Table, values: Record<string, unknown>): Promise<InsertResult>;
  list(table: Table, query: ListQuery): Promise<Row[]>;
}

/// A database error turned into words a person can act on.
export class StoreError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
