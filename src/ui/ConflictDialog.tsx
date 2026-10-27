import { decodeLabels, priorityLabels, statusLabels, type Project, type Status } from '../domain/planner';
import { Modal } from './Modal';

const labels: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  project_id: 'Project',
  labels: 'Labels',
  start_date: 'Start',
  due_date: 'Due',
  estimate_minutes: 'Estimate (min)',
  critical: 'Critical',
  completed_at_ms: 'Completed',
  deleted_at_ms: 'Deleted',
};

function show(field: string, value: unknown, projects: Project[]): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status') return statusLabels[value as Status] ?? String(value);
  if (field === 'priority') return priorityLabels[Number(value)] ?? String(value);
  if (field === 'project_id') return projects.find((p) => p.id === value)?.name ?? 'Inbox';
  if (field === 'labels') return decodeLabels(String(value)).join(', ') || '—';
  if (field === 'completed_at_ms' || field === 'deleted_at_ms') return new Date(Number(value)).toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/// Shown when a task changed on another device while it was open here.
/// Nothing has been written yet; the person chooses.
export function ConflictDialog({
  current,
  mine,
  projects,
  onApplyMine,
  onKeepTheirs,
}: {
  current: object;
  mine: Record<string, unknown>;
  projects: Project[];
  onApplyMine: () => void;
  onKeepTheirs: () => void;
}) {
  const saved = current as Record<string, unknown>;
  const fields = Object.keys(mine).filter((f) => f !== 'completed_at_ms' || !('status' in mine));
  return (
    <Modal title="This changed on another device" onClose={onKeepTheirs} wide>
      <div className="stack">
        <p>
          While you were editing, this task was saved somewhere else (usually your phone). Your changes are not saved
          yet. Compare and choose what to keep.
        </p>
        <table className="compare">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Saved now</th>
              <th scope="col">Your change</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field}>
                <th scope="row">{labels[field] ?? field}</th>
                <td>{show(field, saved[field], projects)}</td>
                <td>{show(field, mine[field], projects)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          “Use my changes” puts only the fields above on top of the version saved now. Everything else from the other
          device is kept.
        </p>
        <div className="row end">
          <button onClick={onKeepTheirs} autoFocus>
            Discard my changes
          </button>
          <button className="primary" onClick={onApplyMine}>
            Use my changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
