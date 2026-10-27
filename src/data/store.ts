/// The narrow database surface the repositories need. The Supabase version
/// lives in `supabaseStore.ts`; tests use an in-memory fake that copies the
/// server triggers.
export type Table = 'tasks' | 'item_notes';

export type Row = Record<string, unknown> & { id: string; revision: number };

export type InsertResult = { kind: 'inserted'; row: Row } | { kind: 'duplicate' };

export interface ListQuery {
  /// Only rows whose `parent_id` matches (notes).
  parentId?: string;
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
