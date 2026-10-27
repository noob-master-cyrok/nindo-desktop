import { urgencyLabels, type TaskRow } from '../domain/task';
import { Modal } from './Modal';

const labels: Record<string, string> = {
  title: 'Title',
  due_date_ad: 'Date',
  due_time: 'Time',
  undated: 'No date',
  urgency: 'Urgency',
  category: 'Category',
  notes: 'Notes',
  alert_offsets: 'Alerts',
  steps: 'Steps',
  completed_at_ms: 'Completed',
  deleted_at_ms: 'Deleted',
  body: 'Note',
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'urgency') return urgencyLabels[Number(value)] ?? String(value);
  if (field === 'steps' && Array.isArray(value)) {
    return value.map((s: { title: string; done: boolean }) => `${s.done ? '☑' : '☐'} ${s.title}`).join('\n') || '—';
  }
  if (field === 'completed_at_ms' || field === 'deleted_at_ms') return new Date(Number(value)).toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/// Shown when a task or note changed on another device while it was open
/// here. Nothing has been written yet; the person chooses.
export function ConflictDialog({
  current,
  mine,
  onApplyMine,
  onKeepTheirs,
}: {
  current: Record<string, unknown> & Partial<TaskRow>;
  mine: Record<string, unknown>;
  onApplyMine: () => void;
  onKeepTheirs: () => void;
}) {
  const fields = Object.keys(mine);
  return (
    <Modal title="This changed on another device" onClose={onKeepTheirs} wide>
      <div className="stack">
        <p>
          While you were editing, this was saved somewhere else (usually your phone). Your changes are not saved yet.
          Compare and choose what to keep.
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
                <td>{show(field, current[field])}</td>
                <td>{show(field, mine[field])}</td>
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
