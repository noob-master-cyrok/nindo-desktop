import { compareItems, isDone, recurrence, type Item } from './item';
import { occurrencesBetween } from './recurrence';

/// One item on one day. A repeating item appears on each of its dates; only
/// the stored date (`current`) is the one Done and Skip act on.
export interface Entry {
  item: Item;
  date: string;
  current: boolean;
}

/// Every dated item on each day from [from] to [to]. Finished items show on
/// their date; open repeating items on every date of the series.
export function entriesBetween(items: Item[], from: string, to: string): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    if (item.undated || item.deleted_at_ms != null) continue;
    const dates = isDone(item)
      ? item.due_date_ad >= from && item.due_date_ad <= to
        ? [item.due_date_ad]
        : []
      : occurrencesBetween(recurrence(item), item.due_date_ad, from, to);
    for (const date of dates) out.push({ item, date, current: date === item.due_date_ad });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || compareItems(a.item, b.item));
}

/// Entries grouped by date.
export function byDay(entries: Entry[]): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const e of entries) map.set(e.date, [...(map.get(e.date) ?? []), e]);
  return map;
}
