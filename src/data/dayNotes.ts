import { fullScope, type ReportScope } from '../domain/daySummary';

/// Notes and points to present, one text per day. Supabase holds them
/// (planner_day_notes, migration 0007); this computer keeps a copy so the
/// panel opens at once and typing offline is not lost. Days typed here and
/// not yet saved to Supabase are listed under [unsyncedKey].

const key = 'nindo.desktop.dayNotes';

export const dayNoteLimit = 4000;

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function dayNote(day: string): string {
  const v = readAll()[day];
  return typeof v === 'string' ? v : '';
}

/// Saves [text] for [day]; an empty text removes the day. False when the
/// browser refuses (a private window, or storage full).
export function saveDayNote(day: string, text: string): boolean {
  const all = readAll();
  const clean = text.slice(0, dayNoteLimit);
  if (clean.trim()) all[day] = clean;
  else delete all[day];
  try {
    localStorage.setItem(key, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

const unsyncedKey = 'nindo.desktop.dayNotesUnsynced';

function readUnsynced(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(unsyncedKey) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeUnsynced(days: string[]) {
  try {
    localStorage.setItem(unsyncedKey, JSON.stringify([...new Set(days)]));
  } catch {
    // Private windows may refuse; the note is then sent on the next save.
  }
}

export function markUnsynced(day: string) {
  writeUnsynced([...readUnsynced(), day]);
}

export function markSynced(day: string) {
  writeUnsynced(readUnsynced().filter((d) => d !== day));
}

/// Days to send to Supabase: typed here and not saved yet, or kept only on
/// this computer from before notes synced.
export function daysToUpload(remote: Record<string, string>): string[] {
  const local = readAll();
  const pending = new Set(readUnsynced());
  return Object.keys(local).filter((d) => pending.has(d) || !(d in remote));
}

/// The server's notes become this computer's copy, except days still waiting
/// to upload.
export function adoptRemote(remote: Record<string, string>): Record<string, string> {
  const local = readAll();
  const pending = new Set(readUnsynced());
  const merged: Record<string, string> = {};
  for (const [d, text] of Object.entries(remote)) if (text.trim()) merged[d] = text;
  for (const d of pending) {
    if (local[d]) merged[d] = local[d];
    else delete merged[d];
  }
  try {
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    // Keep going with what is in memory.
  }
  return merged;
}

/// Every day that has a note, newest first, for an export.
export function noteDays(): string[] {
  return Object.keys(readAll()).sort().reverse();
}

/// Every day's note, for a week or month report.
export function allDayNotes(): Record<string, string> {
  return readAll();
}

const scopeKey = 'nindo.desktop.reportScope';

/// Which projects, labels and tasks the reports talk about; one choice for
/// every day, kept on this computer.
export function loadReportScope(): ReportScope {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(scopeKey) ?? 'null');
    if (!raw || typeof raw !== 'object') return fullScope;
    const r = raw as Partial<Record<keyof ReportScope, unknown>>;
    const list = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
    const str = (x: unknown): x is string => typeof x === 'string';
    return {
      projects: list(r.projects, (x): x is string | null => x === null || typeof x === 'string'),
      labels: list(r.labels, str),
      hidden: list(r.hidden, str),
    };
  } catch {
    return fullScope;
  }
}

export function saveReportScope(scope: ReportScope): void {
  try {
    localStorage.setItem(scopeKey, JSON.stringify(scope));
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}
