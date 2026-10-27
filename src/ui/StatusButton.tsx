import { statusLabels, type Status } from '../domain/planner';

const glyph: Record<Status, string> = {
  backlog: '◌',
  todo: '○',
  doing: '◐',
  done: '●',
  cancelled: '⊘',
};

/// The phone's status circle: a tap moves the task on.
export function StatusButton({ status, title, onClick }: { status: Status; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`status s-${status}`}
      aria-label={`${statusLabels[status]}: ${title}. Change status`}
      title={`${statusLabels[status]} (click to move on)`}
      onClick={onClick}
    >
      <span aria-hidden="true">{glyph[status]}</span>
    </button>
  );
}
