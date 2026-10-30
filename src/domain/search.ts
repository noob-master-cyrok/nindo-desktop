/// Search over everything the desktop holds, ported from the phone's
/// lib/features/search: calendar items (reminders, bills, birthdays…) with
/// their descriptions, steps, notes and category; planner tasks with their
/// sub-tasks and labels; and the city calendar's festivals in both languages
/// with their notes. People, alarms and Google events stay on the phone.
///
/// Matching is case-insensitive and finds text anywhere inside a field.
/// Things holding the whole phrase come first ("Matches"); for a query of
/// several words, things holding only some of them follow ("Partial matches").

import { builtInCategories, isDone, kindLabel, type Item } from './item';
import { decodeLabels, type PlannerTask } from './planner';
import type { Festival } from './calendar';

/// What a result opens.
export type SearchKind = 'item' | 'task' | 'festival';

/// Which part of a result held the text, for the line under its title.
export type FieldKind = 'title' | 'notes' | 'step' | 'note' | 'category' | 'otherName';

export const fieldLabels: Record<FieldKind, string> = {
  title: 'Search',
  notes: 'Description',
  step: 'Step',
  note: 'Note',
  category: 'Category',
  otherName: 'Also',
};

export interface SearchField {
  kind: FieldKind;
  text: string;
}

/// One searchable thing; [fields] is everything that can match besides the title.
export interface SearchDoc {
  kind: SearchKind;
  id: string;
  title: string;
  fields: SearchField[];
  /// When it happens (ISO), for ordering; null for undated things.
  day: string | null;
  /// Finished: listed after the open ones.
  done: boolean;
  /// What the result row says about it: "Bill", "Holiday", "In progress"…
  label: string;
  /// The time of day, for items that have one.
  time?: string | null;
  /// The festival itself, for opening its page.
  festival?: Festival;
}

export interface SearchHit {
  doc: SearchDoc;
  /// How many of the query's words it holds.
  matchedTerms: number;
  /// The title itself matched.
  inTitle: boolean;
  /// The best other field that matched, shown under the title; null when
  /// only the title matched.
  detail: SearchField | null;
}

export interface SearchResults {
  query: string;
  terms: string[];
  /// Things holding the whole phrase (every match, for one word).
  full: SearchHit[];
  /// Things holding only some of the words.
  partial: SearchHit[];
}

/// Rows listed per group; more asks for another word.
export const searchPageSize = 60;

/// Lower case with every run of spaces, tabs or new lines as one space.
export const normalizeSearchText = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/// The words of a query, without repeats, longest first so a highlight of
/// "motor" is not cut short by a match of "mo".
export function searchTerms(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(' ').filter(Boolean))].sort((a, b) => b.length - a.length);
}

const emptyResults = (query: string): SearchResults => ({ query, terms: [], full: [], partial: [] });

/// Finds [query] in [docs]. Results are ordered: more words first, title
/// matches first, then open before finished, then by date (upcoming soonest,
/// then the most recent past, then undated), then by title.
export function search(docs: SearchDoc[], query: string, today: string): SearchResults {
  const phrase = normalizeSearchText(query);
  const terms = searchTerms(query);
  if (!phrase) return emptyResults(query);

  const full: SearchHit[] = [];
  const partial: SearchHit[] = [];
  for (const doc of docs) {
    const fields: SearchField[] = [{ kind: 'title', text: doc.title }, ...doc.fields.filter((f) => f.text.trim())];
    const texts = fields.map((f) => normalizeSearchText(f.text));

    const phraseAt = texts.findIndex((t) => t.includes(phrase));
    if (phraseAt >= 0) {
      const inTitle = texts[0]!.includes(phrase);
      full.push({ doc, matchedTerms: terms.length, inTitle, detail: inTitle ? null : fields[phraseAt]! });
      continue;
    }
    if (terms.length < 2) continue;

    const count = terms.filter((w) => texts.some((t) => t.includes(w))).length;
    if (count === 0) continue;
    const inTitle = terms.some((w) => texts[0]!.includes(w));
    // The field holding the most words explains the match best.
    const score = (i: number) => terms.filter((w) => texts[i]!.includes(w)).length;
    let best = -1;
    for (let i = 1; i < texts.length; i++) if (score(i) > 0 && (best < 0 || score(i) > score(best))) best = i;
    partial.push({
      doc,
      matchedTerms: count,
      inTitle,
      // A field that adds words the title lacks is worth showing.
      detail: best < 0 || (inTitle && score(best) <= score(0)) ? null : fields[best]!,
    });
  }

  const byDate = (a: string | null, b: string | null) => {
    if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
    const pastA = a < today, pastB = b < today;
    if (pastA !== pastB) return pastA ? 1 : -1;
    return pastA ? b.localeCompare(a) : a.localeCompare(b);
  };
  const order = (a: SearchHit, b: SearchHit) =>
    b.matchedTerms - a.matchedTerms ||
    (a.inTitle !== b.inTitle ? (a.inTitle ? -1 : 1) : 0) ||
    (a.doc.done !== b.doc.done ? (a.doc.done ? 1 : -1) : 0) ||
    byDate(a.doc.day, b.doc.day) ||
    a.doc.title.toLowerCase().localeCompare(b.doc.title.toLowerCase());

  return { query, terms, full: full.sort(order), partial: partial.sort(order) };
}

/// The parts of [text] to highlight for [terms], as sorted, merged
/// [start, end) ranges. Empty when lower-casing changes the text's length (a
/// few scripts), so ranges never land on the wrong letters.
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [];
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/// A one-line window of [text] (spaces collapsed) around its first match,
/// with "…" where it was cut.
export function searchSnippet(text: string, terms: string[], width = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return `${flat.slice(0, width).trimEnd()}…`;
  let start = Math.max(0, at - Math.floor(width / 3));
  let end = start + width;
  if (end > flat.length) {
    end = flat.length;
    start = Math.max(0, end - width);
  }
  // Cut on spaces so words stay whole.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

const plannerStatus: Record<string, string> = { backlog: 'Backlog', todo: 'To do', doing: 'In progress', done: 'Done', cancelled: 'Cancelled' };

/// The phone shows built-in categories by name ("Health"); own ones as typed.
const categoryName = (key: string) => ((builtInCategories as readonly string[]).includes(key) ? key[0]!.toUpperCase() + key.slice(1) : key);

/// Everything search looks through, as [SearchDoc]s. [festivals] are the
/// city calendar's (those notes can hang on), as on the phone.
/// A note on an item ('task') or a festival, as synced from the phone.
interface NoteText {
  parent_type: string;
  parent_id: string;
  body: string;
  deleted_at_ms: number | null;
}

export function buildSearchDocs({ items, notes, tasks, festivals }: { items: Item[]; notes: NoteText[]; tasks: PlannerTask[]; festivals: Festival[] }): SearchDoc[] {
  const notesOf = new Map<string, string[]>();
  for (const n of notes) {
    if (n.deleted_at_ms != null) continue;
    const key = `${n.parent_type}:${n.parent_id}`;
    notesOf.set(key, [...(notesOf.get(key) ?? []), n.body]);
  }
  const subtasksOf = new Map<string, string[]>();
  for (const t of tasks) if (t.parent_id && t.deleted_at_ms == null) subtasksOf.set(t.parent_id, [...(subtasksOf.get(t.parent_id) ?? []), t.title]);

  const docs: SearchDoc[] = [];
  for (const i of items) {
    if (i.deleted_at_ms != null) continue;
    docs.push({
      kind: 'item',
      id: i.id,
      title: i.title,
      day: i.undated ? null : i.due_date_ad,
      time: i.undated ? null : i.due_time,
      done: isDone(i),
      label: kindLabel(i.kind),
      fields: [
        { kind: 'notes', text: i.notes ?? '' },
        ...i.steps.map((s) => ({ kind: 'step' as const, text: s.title })),
        ...(notesOf.get(`task:${i.id}`) ?? []).map((text) => ({ kind: 'note' as const, text })),
        { kind: 'category', text: i.category ? categoryName(i.category) : '' },
      ],
    });
  }
  // The planner's tasks; sub-tasks are found through their task's steps.
  for (const t of tasks) {
    if (t.parent_id || t.deleted_at_ms != null) continue;
    docs.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      day: t.due_date,
      done: t.status === 'done' || t.status === 'cancelled',
      label: plannerStatus[t.status] ?? t.status,
      fields: [
        { kind: 'notes', text: t.description },
        ...(subtasksOf.get(t.id) ?? []).map((text) => ({ kind: 'step' as const, text })),
        ...decodeLabels(t.labels).map((text) => ({ kind: 'category' as const, text })),
      ],
    });
  }
  for (const f of festivals) {
    if (!f.noteId) continue;
    docs.push({
      kind: 'festival',
      id: `${f.id}@${f.iso}`,
      title: f.nameEn,
      day: f.iso,
      done: false,
      label: f.holiday ? 'Holiday' : 'Festival',
      festival: f,
      fields: [{ kind: 'otherName', text: f.nameNe }, ...(notesOf.get(`festival:${f.noteId}`) ?? []).map((text) => ({ kind: 'note' as const, text }))],
    });
  }
  return docs;
}
