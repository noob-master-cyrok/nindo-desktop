import { useState, type FormEvent } from 'react';
import type { NotesRepo } from '../data/notesRepo';
import type { SaveResult, TasksRepo } from '../data/tasksRepo';
import { diffFields } from '../data/writeRules';
import { relativeTime } from '../domain/filters';
import {
  isReadOnly,
  isRepeating,
  localIsoDate,
  normalizeOffsets,
  repeatSummary,
  urgencyLabels,
  type Step,
  type TaskEdit,
  type TaskRow,
} from '../domain/task';
import { ConflictDialog } from './ConflictDialog';
import { Confirm } from './Modal';
import { NotesPanel } from './NotesPanel';

interface Form {
  title: string;
  due_date_ad: string;
  due_time: string;
  undated: boolean;
  urgency: number;
  category: string;
  notes: string;
  alert_offsets: string;
  steps: Step[];
}

function toForm(task: TaskRow | null): Form {
  return {
    title: task?.title ?? '',
    due_date_ad: task?.due_date_ad ?? localIsoDate(new Date()),
    due_time: task?.due_time ?? '',
    undated: task?.undated ?? false,
    urgency: task?.urgency ?? 1,
    category: task?.category ?? '',
    notes: task?.notes ?? '',
    alert_offsets: task?.alert_offsets ?? '',
    steps: task?.steps ?? [],
  };
}

/// Form values in the shape the database stores.
function toEdit(form: Form): TaskEdit | string {
  const offsets = normalizeOffsets(form.alert_offsets);
  if (offsets === null) return 'Alerts are minutes before the due time, like 10,60.';
  return {
    title: form.title.trim(),
    due_date_ad: form.due_date_ad || localIsoDate(new Date()),
    due_time: form.due_time || null,
    undated: form.undated,
    urgency: form.urgency,
    category: form.category.trim() || null,
    notes: form.notes.trim() ? form.notes : null,
    alert_offsets: offsets,
    steps: form.steps
      .map((s) => ({ ...s, title: s.title.trim() }))
      .filter((s) => s.title),
  };
}

type Pending = { current: TaskRow; mine: Record<string, unknown> };

export function TaskEditor({
  task,
  tasks,
  notes,
  onSaved,
  onGone,
  onClose,
}: {
  task: TaskRow | null;
  tasks: TasksRepo;
  notes: NotesRepo;
  onSaved: (row: TaskRow) => void;
  onGone: (id: string) => void;
  onClose: () => void;
}) {
  const [base, setBase] = useState(task);
  const [form, setForm] = useState(() => toForm(task));
  const [newStep, setNewStep] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Pending | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const readOnly = base ? isReadOnly(base) : false;
  const repeating = base ? isRepeating(base) : false;
  const edit = toEdit(form);
  const changes = base && typeof edit !== 'string' ? diffFields(base, edit) : {};
  const dirty = base ? Object.keys(changes).length > 0 : form.title.trim() !== '';

  function patch(fields: Partial<Form>) {
    setForm((f) => ({ ...f, ...fields }));
    setMessage(null);
  }

  async function run(action: () => Promise<SaveResult<TaskRow>>, done?: string) {
    setBusy(true);
    setProblems([]);
    setMessage(null);
    try {
      const result = await action();
      switch (result.status) {
        case 'saved':
          if (result.row.deleted_at_ms != null) {
            onGone(result.row.id);
            break;
          }
          setBase(result.row);
          setForm(toForm(result.row));
          onSaved(result.row);
          if (done) setMessage(done);
          break;
        case 'invalid':
          setProblems(result.problems);
          break;
        case 'conflict':
          setConflict({ current: result.current, mine: result.mine });
          break;
        case 'gone':
          onGone(base?.id ?? '');
          break;
      }
    } catch (error) {
      setProblems([error instanceof Error ? error.message : 'Something went wrong. Try again.']);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (typeof edit === 'string') return setProblems([edit]);
    if (!base) {
      return run(
        () => tasks.create({ ...edit, title: edit.title ?? '', due_date_ad: edit.due_date_ad ?? form.due_date_ad }),
        'Task added.',
      );
    }
    if (!dirty) return;
    return run(() => tasks.update(base.id, base.revision, changes), 'Saved.');
  }

  const stepsChange = (steps: Step[]) => patch({ steps });
  const moveStep = (index: number, by: number) => {
    const steps = [...form.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + by, 0, step!);
    stepsChange(steps);
  };

  return (
    <section className="editor" aria-label={base ? 'Edit task' : 'New task'}>
      <header className="editor-head">
        <h2>{base ? 'Task' : 'New task'}</h2>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </header>

      {readOnly && <p className="banner">Imported from Google Calendar. It is read-only here.</p>}
      {base && base.completed_at_ms && (
        <p className="banner done">Completed {new Date(base.completed_at_ms).toLocaleString()}</p>
      )}

      <form onSubmit={save} className="stack">
        <fieldset disabled={readOnly || busy} className="stack">
          <label className="field">
            <span>Title</span>
            <input value={form.title} maxLength={200} required onChange={(e) => patch({ title: e.target.value })} autoFocus={!base} />
          </label>

          <div className="grid3">
            <label className="field">
              <span>Date (AD)</span>
              <input
                type="date"
                value={form.due_date_ad}
                disabled={form.undated}
                required={!form.undated}
                onChange={(e) => patch({ due_date_ad: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Time</span>
              <input
                type="time"
                value={form.due_time}
                disabled={form.undated}
                onChange={(e) => patch({ due_time: e.target.value })}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={form.undated} onChange={(e) => patch({ undated: e.target.checked })} />
              <span>No date</span>
            </label>
          </div>
          {base?.date_system === 'BS' && <p className="muted small">Set as a Bikram Sambat date on the phone. The phone shows the BS date.</p>}

          <div className="grid2">
            <label className="field">
              <span>Urgency</span>
              <select value={form.urgency} onChange={(e) => patch({ urgency: Number(e.target.value) })}>
                {urgencyLabels.map((label, value) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Category</span>
              <input value={form.category} maxLength={40} onChange={(e) => patch({ category: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>Alerts (minutes before, comma separated)</span>
            <input
              value={form.alert_offsets}
              placeholder="e.g. 10,60"
              onChange={(e) => patch({ alert_offsets: e.target.value })}
            />
          </label>

          <div className="field">
            <span>Repeat</span>
            <p className="readonly">{base ? repeatSummary(base) : 'Does not repeat'}</p>
            {repeating && <p className="muted small">Change repeats on your phone.</p>}
          </div>

          <div className="field">
            <span>Steps</span>
            <ul className="steps">
              {form.steps.map((step, index) => (
                <li key={step.id}>
                  <input
                    type="checkbox"
                    aria-label={`Done: ${step.title}`}
                    checked={step.done}
                    onChange={(e) =>
                      stepsChange(form.steps.map((s) => (s.id === step.id ? { ...s, done: e.target.checked } : s)))
                    }
                  />
                  <input
                    aria-label="Step title"
                    value={step.title}
                    maxLength={200}
                    onChange={(e) =>
                      stepsChange(form.steps.map((s) => (s.id === step.id ? { ...s, title: e.target.value } : s)))
                    }
                  />
                  <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label="Move down"
                    disabled={index === form.steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Remove step ${step.title}`}
                    onClick={() => stepsChange(form.steps.filter((s) => s.id !== step.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="row">
              <input
                aria-label="New step"
                placeholder="Add a step"
                value={newStep}
                maxLength={200}
                onChange={(e) => setNewStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!newStep.trim()) return;
                    stepsChange([...form.steps, { id: crypto.randomUUID(), title: newStep.trim(), done: false }]);
                    setNewStep('');
                  }
                }}
              />
              <button
                type="button"
                disabled={!newStep.trim()}
                onClick={() => {
                  stepsChange([...form.steps, { id: crypto.randomUUID(), title: newStep.trim(), done: false }]);
                  setNewStep('');
                }}
              >
                Add
              </button>
            </div>
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea rows={4} maxLength={4000} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>
        </fieldset>

        {problems.length > 0 && (
          <ul className="error" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {message && (
          <p className="ok" role="status">
            {message}
          </p>
        )}

        {!readOnly && (
          <div className="row">
            <button className="primary" disabled={busy || !dirty}>
              {base ? 'Save' : 'Add task'}
            </button>
            {base && !base.completed_at_ms && (
              <button
                type="button"
                disabled={busy || repeating || dirty}
                title={repeating ? 'Complete repeating tasks on your phone so they move to the next date.' : undefined}
                onClick={() => run(() => tasks.complete(base), 'Marked complete.')}
              >
                Complete
              </button>
            )}
            {base && base.completed_at_ms && (
              <button type="button" disabled={busy || dirty} onClick={() => run(() => tasks.reopen(base), 'Reopened.')}>
                Reopen
              </button>
            )}
            {base && (
              <button type="button" className="danger push" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
        )}
        {base && !readOnly && repeating && !base.completed_at_ms && (
          <p className="muted small">This task repeats. Complete it on your phone so it moves to the next date.</p>
        )}
        {base && !readOnly && dirty && <p className="muted small">Save your changes before completing.</p>}
        {base && <p className="muted small">Last changed {relativeTime(base.server_updated_at, Date.now())}</p>}
      </form>

      {base && <NotesPanel key={base.id} taskId={base.id} notes={notes} readOnly={readOnly} />}

      {conflict && (
        <ConflictDialog
          current={conflict.current}
          mine={conflict.mine}
          onKeepTheirs={() => {
            setBase(conflict.current);
            setForm(toForm(conflict.current));
            onSaved(conflict.current);
            setConflict(null);
            setMessage('Showing the version saved on your other device.');
          }}
          onApplyMine={() => {
            const { current, mine } = conflict;
            setConflict(null);
            run(() => tasks.update(current.id, current.revision, mine), 'Saved.');
          }}
        />
      )}
      {confirmDelete && base && (
        <Confirm
          title="Delete this task?"
          body={
            <p>
              “{base.title}” will be removed here and from your phone the next time it syncs. This cannot be undone.
            </p>
          }
          action="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            run(() => tasks.remove(base));
          }}
        />
      )}
    </section>
  );
}
