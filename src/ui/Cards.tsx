import { useState } from 'react';
import {
  dailyPlanningId,
  defaultHighlights,
  durationLabel,
  isMajor,
  statusLabels,
  todaysHighlights,
  type Activity,
  type HighlightFilter,
  type PlannerTask,
  type Project,
  type Status,
} from '../domain/planner';
import { useSettings } from '../settings';
import { Checklist, FilterIcon, Flame, Seal, Sparkles, StatusIcon } from './Icons';
import { Modal } from './Modal';

export function clock(ms: number, num: (v: string) => string): string {
  return num(new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
}

/// The phone's summary strip: open, in progress, overdue, done this week.
export function Summary({ open, doing, overdue, doneWeek }: { open: number; doing: number; overdue: number; doneWeek: number }) {
  const { num } = useSettings();
  const cell = (label: string, value: number, tone: string) => (
    <div className="sum-cell" aria-label={`${label}, ${value}`} role="group">
      <span className={`sum-value ${tone}`} aria-hidden="true">
        {num(value)}
      </span>
      <span className="sum-label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
  return (
    <div className="summary">
      {cell('Open', open, 'ink')}
      {cell('In progress', doing, 'attn')}
      {cell('Overdue', overdue, overdue > 0 ? 'danger' : 'ink')}
      {cell('Done this week', doneWeek, 'done')}
    </div>
  );
}

/// Today's Daily planning task, started and finished once, as on the phone.
/// Hidden on days without one.
export function DailyPlanningCard({
  tasks,
  activity,
  today,
  onStart,
  onFinish,
}: {
  tasks: PlannerTask[];
  activity: Activity[];
  today: string;
  onStart: (task: PlannerTask) => void;
  onFinish: (task: PlannerTask) => void;
}) {
  const { num } = useSettings();
  const [asking, setAsking] = useState(false);
  const task = tasks.find((t) => t.id === dailyPlanningId(today));
  if (!task || task.status === 'cancelled') return null;
  const done = task.status === 'done';
  const running = task.status === 'doing';
  // When it went in progress, from its history.
  const started = activity
    .filter((a) => a.task_id === task.id && a.kind === 'status' && a.body === 'doing')
    .reduce<number | null>((last, a) => Math.max(last ?? 0, a.created_at_ms), null);
  const spent = started ? Math.max(0, Math.round(((done ? (task.completed_at_ms ?? Date.now()) : Date.now()) - started) / 60000)) : null;

  return (
    <section className={running ? 'plan-card running' : 'plan-card'} aria-label="Daily planning">
      <span className={running ? 'plan-icon done-tone' : 'plan-icon'}>{done ? <Seal size={26} /> : <Checklist size={26} />}</span>
      <div className="plan-text">
        <strong>Daily planning</strong>
        <span className="muted small">
          {done
            ? `Done${spent !== null ? ` · ${durationLabel(spent, num)}` : ''}`
            : running
              ? started
                ? `Started ${clock(started, num)} · ${durationLabel(spent ?? 0, num)}`
                : 'In progress'
              : 'Plan the day and get set up · Urgent'}
        </span>
      </div>
      {!done && (
        <button className={running ? 'primary done-fill' : 'primary'} onClick={() => (running ? setAsking(true) : onStart(task))}>
          {running ? 'Finish' : 'Start'}
        </button>
      )}
      {asking && (
        <Modal title="Finish daily planning?" onClose={() => setAsking(false)}>
          <div className="stack">
            <p>Once a day. The time counts toward Work in Insights on your phone when its timer ran there.</p>
            <div className="row end">
              <button className="secondary" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  setAsking(false);
                  onFinish(task);
                }}
              >
                Finish
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

const highlightStatuses: Status[] = ['done', 'doing', 'cancelled'];

/// Today's highlights: what got done today, the major tasks first.
export function Highlights({
  tasks,
  activity,
  projects,
  dayStart,
  onOpen,
}: {
  tasks: PlannerTask[];
  activity: Activity[];
  projects: Project[];
  dayStart: number;
  onOpen: (id: string) => void;
}) {
  const { num } = useSettings();
  const [filter, setFilter] = useState<HighlightFilter>(defaultHighlights);
  const [editing, setEditing] = useState<HighlightFilter | null>(null);
  const [all, setAll] = useState(false);
  const list = todaysHighlights(tasks, activity, dayStart, filter);
  const total = list.reduce((sum, h) => sum + h.minutesToday, 0);
  const narrowed = JSON.stringify(filter) !== JSON.stringify(defaultHighlights);
  const shown = all ? list : list.slice(0, 5);
  const toggle = <T,>(xs: T[], v: T) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);

  return (
    <section className="panel-card" aria-label="Today's highlights">
      <header className="card-head">
        <Sparkles size={20} className="acc-ink" />
        <div className="card-titles">
          <h2 className="card-title">Today's highlights</h2>
          <p className="muted small">
            {list.length
              ? total
                ? `${num(list.length)} today · ${durationLabel(total, num)} spent`
                : `${num(list.length)} today`
              : 'What you finished today, the major tasks first.'}
          </p>
        </div>
        <button className="icon-button push" aria-label="Filter highlights" title="Filter highlights" onClick={() => setEditing(filter)}>
          <FilterIcon on={narrowed} />
        </button>
      </header>
      {list.length === 0 ? (
        <p className="muted small card-empty">{narrowed ? 'No tasks today match the filter.' : 'Nothing finished yet today. Tasks you finish show here.'}</p>
      ) : (
        <ul className="ruled">
          {shown.map(({ task, minutesToday }) => (
            <li key={task.id}>
              <button className="hl-row" onClick={() => onOpen(task.id)}>
                <span className={`s-${task.status}`}>
                  <StatusIcon status={task.status} size={18} />
                </span>
                <span className="hl-title">{task.title}</span>
                {isMajor(task) && (
                  <span className="crit">
                    <Flame size={11} /> Major
                  </span>
                )}
                <span className="muted small hl-when">
                  {task.status === 'done' && task.completed_at_ms
                    ? `Done ${clock(task.completed_at_ms, num)}`
                    : minutesToday
                      ? `${durationLabel(minutesToday, num)} today`
                      : statusLabels[task.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 5 && (
        <button className="text" onClick={() => setAll(!all)}>
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
      {editing && (
        <Modal title="Filter highlights" onClose={() => setEditing(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter(editing.statuses.length ? editing : { ...editing, statuses: ['done'] });
              setEditing(null);
            }}
          >
            <fieldset className="set-group">
              <legend className="kicker">Status</legend>
              <div className="chips">
                {highlightStatuses.map((s) => (
                  <button type="button" key={s} className="chip" aria-pressed={editing.statuses.includes(s)} onClick={() => setEditing({ ...editing, statuses: toggle(editing.statuses, s) })}>
                    {statusLabels[s]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="set-group">
              <legend className="kicker">Project</legend>
              <div className="chips">
                {[...projects.filter((p) => !p.archived).map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: 'Inbox' }].map((p) => (
                  <button type="button" key={p.id ?? 'inbox'} className="chip" aria-pressed={editing.projects.includes(p.id)} onClick={() => setEditing({ ...editing, projects: toggle(editing.projects, p.id) })}>
                    {p.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="switch-row">
              <span>
                Major tasks only
                <br />
                <span className="muted small">Critical, high or urgent</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={editing.majorOnly} onChange={(e) => setEditing({ ...editing, majorOnly: e.target.checked })} />
            </label>
            <div className="row end">
              <button type="button" className="text push-right" onClick={() => setEditing(defaultHighlights)}>
                Clear
              </button>
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
