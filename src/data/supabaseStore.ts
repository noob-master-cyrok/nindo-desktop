import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { StoreError, type InsertResult, type ListQuery, type Row, type Store, type Table } from './store';

function friendly(error: PostgrestError | null): StoreError {
  const code = error?.code;
  const message =
    code === '42501'
      ? 'You can only see and change your own tasks. Try signing in again.'
      : code === '23514'
        ? 'The server did not accept one of the values. Check the fields and try again.'
        : code === 'PGRST301' || code === '401'
          ? 'Your session has ended. Sign in again.'
          : "Couldn't reach Nindo's server. Check your connection and try again.";
  // Only the code is logged; row contents and tokens never are.
  console.warn('[nindo] store error', code ?? 'network');
  return new StoreError(message, code);
}

/// [Store] over supabase-js with the anon key. Row-level security limits
/// every query to the signed-in account.
export class SupabaseStore implements Store {
  constructor(private readonly client: SupabaseClient) {}

  async fetchById(table: Table, id: string): Promise<Row | null> {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).maybeSingle();
    if (error) throw friendly(error);
    return data as Row | null;
  }

  async updateIfRevision(table: Table, id: string, revision: number, values: Record<string, unknown>): Promise<Row | null> {
    const { data, error } = await this.client
      .from(table)
      .update(values)
      .eq('id', id)
      .eq('revision', revision)
      .select();
    if (error) throw friendly(error);
    return (data?.[0] as Row | undefined) ?? null;
  }

  async insert(table: Table, values: Record<string, unknown>): Promise<InsertResult> {
    const { data, error } = await this.client.from(table).insert(values).select().single();
    if (error?.code === '23505') return { kind: 'duplicate' };
    if (error) throw friendly(error);
    return { kind: 'inserted', row: data as Row };
  }

  async list(table: Table, query: ListQuery): Promise<Row[]> {
    let request = this.client.from(table).select('*');
    if (!query.includeDeleted) request = request.is('deleted_at_ms', null);
    for (const [column, value] of Object.entries(query.eq ?? {})) request = request.eq(column, value);
    if (query.since) request = request.gte(query.since.column, query.since.value);
    const { data, error } = await request.order(query.orderBy ?? 'id').range(query.from, query.to);
    if (error) throw friendly(error);
    return (data ?? []) as Row[];
  }
}
