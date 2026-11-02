import { fullScope, type ReportScope } from '../domain/daySummary';

/// Notes and points to present, one text per day, kept on this computer.
/// Nothing here syncs yet: Supabase has no table for day notes, and adding
/// one is a migration Safu decides on.

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
