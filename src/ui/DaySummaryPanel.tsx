import { useEffect, useMemo, useRef, useState } from 'react';
import { dayNoteLimit, loadReportScope, saveReportScope } from '../data/dayNotes';
import { bsLabel } from '../domain/bs';
import { addDays, monthLength } from '../domain/dates';
import { fullScope, inScope, noteLines, rangeSummary, reportForClaude, scopeNarrowed, suggestedPoints, summaryText, type ReportScope } from '../domain/daySummary';
import { decodeLabels, durationLabel, localIsoDate, projectColors, type PlannerTask, type Project } from '../domain/planner';
import { startOfLocalDay, weekStart, type TimeData } from '../domain/time';
import { useSettings } from '../settings';
import { clock } from './Cards';
import { Chevron, ChevronSide, Close, Copy, FilterIcon, Sparkles, StatusIcon } from './Icons';
import { Segmented } from './Segmented';

type Period = 'day' | 'week' | 'month';

const periodKey = 'nindo.desktop.reportPeriod';

function fmt(iso: string, o: Intl.DateTimeFormatOptions): string {
  return new Date(startOfLocalDay(iso)).toLocaleDateString('en-GB', o);
}

const longDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = (iso: string) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });

/// The first day and length of the [period] holding [iso].
function rangeOf(period: Period, iso: string): { from: string; count: number } {
  if (period === 'day') return { from: iso, count: 1 };
  if (period === 'week') return { from: weekStart(iso), count: 7 };
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return { from: `${iso.slice(0, 7)}-01`, count: monthLength(y, m) };
}

/// The first day of the [period] before or after the one holding [iso].
function step(period: Period, iso: string, by: 1 | -1): string {
  const { from } = rangeOf(period, iso);
  if (period === 'day') return addDays(from, by);
  if (period === 'week') return addDays(from, 7 * by);
  const [y, m] = from.split('-').map(Number) as [number, number];
  return localIsoDate(new Date(y, m - 1 + by, 1));
}

function lastPeriod(): Period {
  try {
    const v = localStorage.getItem(periodKey);
    return v === 'week' || v === 'month' ? v : 'day';
  } catch {
    return 'day';
  }
}

/// The day, week or month at a glance beside the Tasks page: what got done,
/// what is in hand, time per project, breaks and attendance, the day's own
/// notes and points to present, and a report to copy for a superior, a
/// client or Claude, covering only the projects, labels and tasks picked.
export function DaySummaryPanel({
  tasks,
  projects,
  time,
  loadTime,
  notesByDay,
  onSaveNote,
  today,
  onOpen,
  onClose,
  say,
}: {
  tasks: PlannerTask[];
  projects: Project[];
  time: TimeData | null;
  /// Worked time from [sinceMs] on, for weeks and months before this one
  /// (the page itself loads this week only).
  loadTime: (sinceMs: number) => Promise<TimeData | null>;
  notesByDay: Record<string, string>;
  onSaveNote: (day: string, text: string) => void;
  today: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const { num } = useSettings();
  const [period, setPeriodState] = useState<Period>(lastPeriod);
  const [day, setDay] = useState(today);
  const [notes, setNotes] = useState(() => notesByDay[today] ?? '');
  const [scope, setScopeState] = useState<ReportScope>(loadReportScope);
  const [picking, setPicking] = useState(false);
  const saved = useRef(notes);
  const { from, count } = rangeOf(period, day);
  const start = startOfLocalDay(from);
  const older = start < startOfLocalDay(weekStart(today));
  const [past, setPast] = useState<{ since: number; data: TimeData | null } | null>(null);
  useEffect(() => {
    if (!older || (past && past.since <= start)) return;
    let live = true;
    loadTime(start).then((data) => live && setPast({ since: start, data }));
    return () => {
      live = false;
    };
  }, [older, start, past, loadTime]);
  const rangeTime = older ? (past && past.since <= start ? past.data : null) : time;
  const s = useMemo(() => rangeSummary(from, count, tasks, rangeTime, today, scope), [from, count, tasks, rangeTime, today, scope]);
  const suggested = useMemo(() => suggestedPoints(s, projects), [s, projects]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const at = (ms: number) => clock(ms, num);
  const current = rangeOf(period, today).from === from;

  const setScope = (next: ReportScope) => {
    saveReportScope(next);
    setScopeState(next);
  };
  const setPeriod = (p: Period) => {
    try {
      localStorage.setItem(periodKey, p);
    } catch {
      // Private windows may refuse; the choice then lasts for this visit.
    }
    setPeriodState(p);
  };

  // Typing saves after a pause; switching days saves at once.
  useEffect(() => {
    if (notes === saved.current) return;
    const id = setTimeout(() => {
      onSaveNote(day, notes);
      saved.current = notes;
    }, 600);
    return () => clearTimeout(id);
  }, [notes, day, onSaveNote]);

  // Notes arriving from another computer show here unless typing is under way.
  useEffect(() => {
    const incoming = notesByDay[day] ?? '';
    if (notes === saved.current && incoming !== notes) {
      saved.current = incoming;
      setNotes(incoming);
    }
    // Only when the synced notes or the day change, not on every keystroke.
  }, [notesByDay, day]);

  function goTo(next: string) {
    if (notes !== saved.current) onSaveNote(day, notes);
    const target = next > today ? today : next;
    const text = target === day ? notes : (notesByDay[target] ?? '');
    saved.current = text;
    setNotes(text);
    setDay(target);
  }

  function addSuggested() {
    const have = new Set(noteLines(notes));
    const fresh = suggested.filter((p) => !have.has(p)).map((p) => `• ${p}`);
    if (!fresh.length) return;
    setNotes((n) => [n.trimEnd(), ...fresh].filter(Boolean).join('\n'));
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${what} copied.`);
    } catch {
      say('This browser would not copy. Try again, or select the text and copy it.');
    }
  }

  const title = period === 'day' ? longDay(from) : period === 'week' ? `Week of ${fmt(from, { day: 'numeric', month: 'long', year: 'numeric' })}` : fmt(from, { month: 'long', year: 'numeric' });
  const kicker =
    period === 'day'
      ? day === today
        ? 'Today'
        : day === addDays(today, -1)
          ? 'Yesterday'
          : 'Day summary'
      : current
        ? `This ${period}`
        : `${period === 'week' ? 'Week' : 'Month'} summary`;
  const forClaude = () => {
    return reportForClaude(s, projects, { ...notesByDay, [day]: notes }, title, shortDay);
  };

  const name = (id: string | null) => (id ? (projectById.get(id)?.name ?? 'Other') : 'No project');
  const colour = (id: string | null) => projectColors[id ? (projectById.get(id)?.color ?? 0) : 0];
  const maxProject = Math.max(1, ...s.byProject.map((p) => p.minutes));
  const bs = period === 'day' ? bsLabel(from, num) : null;

  // The picker offers what the range touched, plus whatever is already picked.
  const rangeProjects = [...new Set([...s.touched.map((t) => t.project_id ?? null), ...scope.projects])];
  const rangeLabels = [...new Set([...s.touched.flatMap((t) => decodeLabels(t.labels ?? '')), ...scope.labels])].sort();
  // Tasks left out stay listed (unticked), so they can be put back.
  const listed = s.touched.filter((t) => inScope(t, { ...scope, hidden: [] }));
  const finished = listed.filter((t) => t.status === 'done' && t.completed_at_ms != null && t.completed_at_ms >= startOfLocalDay(from) && t.completed_at_ms < startOfLocalDay(addDays(from, count)));
  const working = listed.filter((t) => !finished.includes(t));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const scopeText = [
    scope.projects.length ? `${num(scope.projects.length)} project${scope.projects.length === 1 ? '' : 's'}` : 'All projects',
    scope.labels.length ? `${num(scope.labels.length)} label${scope.labels.length === 1 ? '' : 's'}` : '',
    scope.hidden.length ? `${num(scope.hidden.length)} task${scope.hidden.length === 1 ? '' : 's'} left out` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const notedDays = (() => {
    const all = notesByDay;
    return Object.keys(all).filter((d) => d >= from && d < addDays(from, count) && noteLines(all[d]!).length).length;
  })();

  const row = (t: PlannerTask, done: boolean) => {
    const kept = !scope.hidden.includes(t.id);
    const m = s.minutesByTask.get(t.id);
    return (
      <li key={t.id} className={kept ? 'day-row' : 'day-row left-out'}>
        <input
          type="checkbox"
          className="report-check"
          checked={kept}
          aria-label={`Include ${t.title} in the report`}
          title={kept ? 'In the report; untick to leave it out' : 'Left out of the report'}
          onChange={() => setScope({ ...scope, hidden: toggle(scope.hidden, t.id) })}
        />
        <button className="day-task" aria-label={`Open ${t.title}`} onClick={() => onOpen(t.id)}>
          <span className={done ? 's-done' : `s-${t.status}`}>
            <StatusIcon status={done ? 'done' : t.status} size={16} />
          </span>
          <span className="day-task-title">{t.title}</span>
          <span className="small muted">
            {done && t.completed_at_ms ? (period === 'day' ? at(t.completed_at_ms) : shortDay(localIsoDate(new Date(t.completed_at_ms)))) : m ? durationLabel(m, num) : ''}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="day-summary">
      <header className="editor-head">
        <div className="day-summary-nav">
          <button className="icon-button small" aria-label={`Previous ${period}`} title={`Previous ${period}`} onClick={() => goTo(step(period, day, -1))}>
            <ChevronSide left size={16} />
          </button>
          <button className="icon-button small" aria-label={`Next ${period}`} title={`Next ${period}`} disabled={step(period, day, 1) > today} onClick={() => goTo(step(period, day, 1))}>
            <ChevronSide size={16} />
          </button>
          {!current && (
            <button className="chip" onClick={() => goTo(today)}>
              Today
            </button>
          )}
        </div>
        <button className="icon-button" aria-label="Hide day summary" title="Hide day summary" onClick={onClose}>
          <Close />
        </button>
      </header>

      <Segmented<Period>
        label="Summary period"
        value={period}
        options={[
          { value: 'day', label: 'Day', title: 'Day' },
          { value: 'week', label: 'Week', title: 'Week' },
          { value: 'month', label: 'Month', title: 'Month' },
        ]}
        onChange={setPeriod}
      />

      <div>
        <p className="kicker">{kicker}</p>
        <h2 className="day-summary-title">{title}</h2>
        {bs && <p className="muted small">{bs}</p>}
      </div>

      <dl className="day-stats">
        <div>
          <dt className="muted small">Done</dt>
          <dd>{num(s.done.length)}</dd>
        </div>
        <div>
          <dt className="muted small">Worked</dt>
          <dd>{s.workedMinutes ? durationLabel(s.workedMinutes, num) : '–'}</dd>
        </div>
        <div>
          <dt className="muted small">Breaks</dt>
          <dd>{s.breakMinutes ? durationLabel(s.breakMinutes, num) : '–'}</dd>
        </div>
        <div>
          <dt className="muted small">At work</dt>
          <dd>
            {period === 'day'
              ? s.checkInMs
                ? `${at(s.checkInMs)}${s.checkOutMs ? `–${at(s.checkOutMs)}` : ''}`
                : '–'
              : s.attendanceMinutes
                ? durationLabel(s.attendanceMinutes, num)
                : '–'}
          </dd>
        </div>
      </dl>

      <section aria-label="What the report covers" className="day-block">
        <button className={scopeNarrowed(scope) ? 'scope-toggle on' : 'scope-toggle'} aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
          <FilterIcon on={scopeNarrowed(scope)} size={18} />
          <span className="scope-words">
            <span className="kicker">Report covers</span>
            <span className="small">{scopeText}</span>
          </span>
          <Chevron up={picking} size={14} className="push muted" />
        </button>
        {picking && (
          <div className="scope-picker">
            <p className="muted small">Projects</p>
            <div className="chips">
              {rangeProjects.length === 0 && <span className="muted small">No work in this {period} yet.</span>}
              {rangeProjects.map((p) => (
                <button key={p ?? 'none'} className="chip" aria-pressed={scope.projects.includes(p)} onClick={() => setScope({ ...scope, projects: toggle(scope.projects, p) })}>
                  <span className="scope-dot" style={{ background: colour(p) }} aria-hidden="true" />
                  {name(p)}
                </button>
              ))}
            </div>
            {rangeLabels.length > 0 && (
              <>
                <p className="muted small">Labels</p>
                <div className="chips">
                  {rangeLabels.map((l) => (
                    <button key={l} className="chip" aria-pressed={scope.labels.includes(l)} onClick={() => setScope({ ...scope, labels: toggle(scope.labels, l) })}>
                      {l}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="muted small">None picked means all. Untick a task below to leave it out. The choice holds for every day, week and month.</p>
            {scopeNarrowed(scope) && (
              <button className="secondary small-button" onClick={() => setScope(fullScope)}>
                Show everything
              </button>
            )}
          </div>
        )}
      </section>

      {s.byProject.length > 0 && (
        <section aria-label="Time by project" className="day-block">
          <p className="kicker">Time by project</p>
          <ul className="project-bars">
            {s.byProject.map((p) => (
              <li key={p.projectId ?? 'none'}>
                <span className="project-bar-name small">{name(p.projectId)}</span>
                <span className="project-bar-track">
                  <span className="project-bar-fill" style={{ width: `${(p.minutes / maxProject) * 100}%`, background: colour(p.projectId) }} />
                </span>
                <span className="small muted">{durationLabel(p.minutes, num)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Finished that day" className="day-block">
        <p className="kicker">Finished</p>
        {finished.length ? (
          <ul className="day-list">{finished.map((t) => row(t, true))}</ul>
        ) : (
          <p className="muted small">Nothing finished {period === 'day' ? (day === today ? 'yet today' : 'that day') : `in this ${period}`}.</p>
        )}
      </section>

      {working.length > 0 && (
        <section aria-label="Worked on" className="day-block">
          <p className="kicker">Worked on</p>
          <ul className="day-list">{working.map((t) => row(t, false))}</ul>
        </section>
      )}

      {period === 'day' ? (
        <section aria-label="Notes and points to present" className="day-block">
          <div className="day-notes-head">
            <label className="kicker" htmlFor="day-notes">
              Notes &amp; points to present
            </label>
            {suggested.length > 0 && (
              <button className="chip" onClick={addSuggested} title="Add points drafted from this day's tasks and time">
                <Sparkles size={14} /> Suggest points
              </button>
            )}
          </div>
          <textarea
            id="day-notes"
            className="day-notes"
            rows={6}
            maxLength={dayNoteLimit}
            placeholder={'One point per line, e.g.\n• Client deck: first draft shared\n• Blocked on budget numbers'}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== saved.current) {
                onSaveNote(day, notes);
                saved.current = notes;
              }
            }}
          />
          <p className="muted small">Saved to your Nindo account, so every computer and the Claude connector see it.</p>
          <div className="report-actions">
            <button className="secondary" onClick={() => copy(summaryText(s, projects, notes, longDay(day), at), 'Day summary')}>
              <Copy size={16} /> Copy day summary
            </button>
            <button className="secondary" onClick={() => copy(forClaude(), 'Report for Claude')} title="Copies the day with a request to write it up; paste it into Claude">
              <Sparkles size={16} /> Copy for Claude
            </button>
          </div>
        </section>
      ) : (
        <section aria-label="Report" className="day-block">
          <p className="muted small">{notedDays ? `Your notes from ${num(notedDays)} day${notedDays === 1 ? '' : 's'} go into the report.` : 'Notes you write in the Day view go into this report.'}</p>
          <button className="secondary" onClick={() => copy(forClaude(), 'Report for Claude')} title="Copies the report with a request to write it up; paste it into Claude">
            <Sparkles size={16} /> Copy {period} report for Claude
          </button>
        </section>
      )}
    </div>
  );
}
