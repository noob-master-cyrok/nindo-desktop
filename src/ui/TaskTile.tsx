import { decodeLabels, durationLabel, isClosed, isOverdue, priorityLabels, statusLabels, type PlannerTask, type Project } from '../domain/planner';
import { useSettings } from '../settings';
import { Calendar, Flame, Indent, PriorityIcon, StatusIcon, Timer } from './Icons';

/// "29 Oct", or "Today".
export function shortDate(iso: string, today: string, num: (v: string) => string): string {
  if (iso === today) return 'Today';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const sameYear = y === Number(today.slice(0, 4));
  return num(date.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }));
}

/// One task in the list or on a board card, as on the phone: the status
/// circle (a click moves it on), the title, then critical, priority,
/// estimate, project, due date, sub-task progress and up to three labels.
export function TaskTile({
  task,
  project,
  subtasks,
  today,
  selected,
  card = false,
  onOpen,
  onCycle,
}: {
  task: PlannerTask;
  /// Left out under a project heading, where it would repeat.
  project?: Project;
  subtasks: PlannerTask[];
  today: string;
  selected: boolean;
  card?: boolean;
  onOpen: () => void;
  onCycle: () => void;
}) {
  const { num } = useSettings();
  const t = task;
  const closed = isClosed(t.status);
  const overdue = isOverdue(t, today);
  const labels = decodeLabels(t.labels);
  const doneSubs = subtasks.filter((s) => isClosed(s.status)).length;
  const meta = (
    <>
      {t.critical && !closed && (
        <span className="crit">
          <Flame size={11} /> Critical
        </span>
      )}
      {t.priority > 0 && (
        <span className="meta-item" title={priorityLabels[t.priority]}>
          <PriorityIcon priority={t.priority} size={14} />
          <span className="sr-only">{priorityLabels[t.priority]}</span>
        </span>
      )}
      {t.estimate_minutes != null && (
        <span className="meta-item">
          <Timer size={12} /> {durationLabel(t.estimate_minutes, num)}
        </span>
      )}
      {project && (
        <span className="meta-item">
          <span className="dot" data-color={project.color} aria-hidden="true" /> {project.name}
        </span>
      )}
      {t.due_date && (
        <span className={overdue ? 'meta-item overdue' : 'meta-item'}>
          <Calendar size={12} /> {overdue && <span className="sr-only">Overdue, due </span>}
          {shortDate(t.due_date, today, num)}
        </span>
      )}
      {subtasks.length > 0 && (
        <span className="meta-item" aria-label={`${doneSubs} of ${subtasks.length} sub-tasks done`}>
          <Indent size={12} /> {num(`${doneSubs}/${subtasks.length}`)}
        </span>
      )}
      {labels.slice(0, 3).map((l) => (
        <span key={l} className="label-chip">
          {l}
        </span>
      ))}
      {labels.length > 3 && <span className="meta-item">+{num(labels.length - 3)}</span>}
    </>
  );

  return (
    <div className={['tile', card ? 'card-tile' : 'row-tile', selected ? 'selected' : ''].join(' ')}>
      <button
        type="button"
        className={`status s-${t.status}`}
        aria-label={`${statusLabels[t.status]}: ${t.title}. Change status`}
        title={`${statusLabels[t.status]} (click to move on)`}
        onClick={onCycle}
      >
        <StatusIcon status={t.status} />
      </button>
      <button type="button" className="tile-open" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <span className={closed ? 'tile-title closed' : 'tile-title'}>{t.title}</span>
        <span className="tile-meta">{meta}</span>
      </button>
    </div>
  );
}
