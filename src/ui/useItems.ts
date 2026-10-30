import { useCallback, useEffect, useState } from 'react';
import type { ItemsRepo, Note } from '../data/itemsRepo';
import { loadCalendar, type NepaliCalendar } from '../domain/calendar';
import type { Item } from '../domain/item';

/// The calendar items and their notes, kept fresh when the window comes back
/// into focus (the phone may have synced meanwhile).
export function useItems(repo: ItemsRepo) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, allNotes] = await Promise.all([repo.listAll(), repo.allNotes()]);
      setItems(rows);
      setNotes(allNotes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your calendar.');
    }
  }, [repo]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const replace = useCallback((row: Item) => {
    setItems((list) => {
      const rest = (list ?? []).filter((i) => i.id !== row.id);
      return row.deleted_at_ms == null ? [...rest, row] : rest;
    });
  }, []);

  const hide = useCallback((id: string) => setItems((list) => (list ?? []).filter((i) => i.id !== id)), []);

  return { items, notes, setNotes, error, load, replace, hide };
}

export type ItemsState = ReturnType<typeof useItems>;

/// The tithi and festival data, loaded once on first use.
export function useNepaliCalendar(): NepaliCalendar | null {
  const [cal, setCal] = useState<NepaliCalendar | null>(null);
  useEffect(() => {
    let live = true;
    loadCalendar().then((c) => live && setCal(c), () => {});
    return () => {
      live = false;
    };
  }, []);
  return cal;
}
