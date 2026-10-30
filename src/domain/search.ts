/// One search over items, notes, planner tasks and festivals, like the
/// phone's: the whole phrase first ("Matches"), then things holding some of
/// the words ("Partial matches", more words first); open before done, then
/// soonest first.

export type SearchKind = 'item' | 'task' | 'festival';

export interface SearchDoc {
  kind: SearchKind;
  id: string;
  title: string;
  /// Other searchable text with a label for the line under the title.
  fields: { label: string; text: string }[];
  day: string | null;
  done: boolean;
}

export interface SearchHit {
  doc: SearchDoc;
  /// The field that matched, when it was not the title.
  where: { label: string; text: string } | null;
  words: number;
}

export const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function searchTerms(query: string): string[] {
  return [...new Set(normalize(query).split(' ').filter(Boolean))].sort((a, b) => b.length - a.length);
}

function order(today: string) {
  return (a: SearchHit, b: SearchHit) => {
    if (a.words !== b.words) return b.words - a.words;
    if (a.doc.done !== b.doc.done) return a.doc.done ? 1 : -1;
    // Upcoming first (soonest), then past (most recent), then undated.
    const rank = (d: string | null) => (d == null ? 2 : d >= today ? 0 : 1);
    const ra = rank(a.doc.day), rb = rank(b.doc.day);
    if (ra !== rb) return ra - rb;
    if (a.doc.day && b.doc.day && a.doc.day !== b.doc.day) return ra === 0 ? a.doc.day.localeCompare(b.doc.day) : b.doc.day.localeCompare(a.doc.day);
    return a.doc.title.localeCompare(b.doc.title);
  };
}

export function search(docs: SearchDoc[], query: string, today: string): { matches: SearchHit[]; partial: SearchHit[] } {
  const phrase = normalize(query);
  const terms = searchTerms(query);
  if (!phrase) return { matches: [], partial: [] };
  const matches: SearchHit[] = [];
  const partial: SearchHit[] = [];
  for (const doc of docs) {
    const all = [{ label: 'Title', text: doc.title }, ...doc.fields];
    const texts = all.map((f) => normalize(f.text));
    const at = texts.findIndex((t) => t.includes(phrase));
    if (at >= 0) {
      matches.push({ doc, where: at === 0 ? null : all[at]!, words: terms.length });
      continue;
    }
    if (terms.length < 2) continue;
    const found = terms.filter((w) => texts.some((t) => t.includes(w)));
    if (found.length) {
      const i = texts.findIndex((t) => t.includes(found[0]!));
      partial.push({ doc, where: i === 0 ? null : all[i]!, words: found.length });
    }
  }
  return { matches: matches.sort(order(today)), partial: partial.sort(order(today)) };
}
