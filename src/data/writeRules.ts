import { serverOwned } from '../domain/task';

/// Edit time for a write. Never behind the row's current edit time, so the
/// server trigger accepts it even when this computer's clock is slow.
export function nextUpdatedAt(now: number, previous: number): number {
  return Math.max(now, previous + 1);
}

/// The complete row to send: the fresh server row with only [changes]
/// applied. Unknown columns are kept as they are; server-owned columns and
/// the id are left out of the SET list.
export function buildPatch(
  fresh: Record<string, unknown>,
  changes: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...fresh, ...changes };
  for (const column of serverOwned) delete patch[column];
  delete patch.id;
  patch.updated_at_ms = nextUpdatedAt(now, Number(fresh.updated_at_ms ?? 0));
  return patch;
}

/// Fields of [edited] that differ from [base], compared by value so an
/// untouched steps array is not counted as a change.
export function diffFields<T extends Record<string, unknown>>(base: T, edited: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(edited) as (keyof T)[]) {
    if (JSON.stringify(edited[key]) !== JSON.stringify(base[key])) out[key] = edited[key];
  }
  return out;
}
