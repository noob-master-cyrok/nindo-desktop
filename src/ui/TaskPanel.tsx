import { useEffect, useState, type FormEvent } from 'react';
import type { PlannerRepo, SaveResult } from '../data/plannerRepo';
import { diffFields } from '../data/writeRules';
import {
  activityText,
  decodeLabels,
  encodeLabels,
  isClosed,
  priorityLabels,
  sortTasks,
  statusChange,
  statusLabels,
  type Activity,
  type Link,
  type PlannerTask,
  type Project,
  type Status,
  type TaskEdit,
} from '../domain/planner';
import { ConflictDialog } from './ConflictDialog';
import { Confirm } from './Modal';

interface Form {
  title: string;
  description: string;
  status: Status;
  priority: number;
  project_id: string;
  labels: string;
  start_date: string;
  due_date: string;
  estimate: string;
  critical: boolean;
}

function toForm(task: PlannerTask | null, defaultProject: string | null): Form {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 0,
    project_id: task ? (task.project_id ?? '') : (defaultProject ?? ''),
    labels: task ? decodeLabels(task.labels).join(', ') : '',
    start_date: task?.start_date ?? '',
    due_date: task?.due_date ?? '',
    estimate: task?.estimate_minutes == null ? '' : String(task.estimate_minutes),
    critical: task?.critical ?? false,
  };
}

/// Form values in the shape the database stores, or a problem to show.
function toEdit(form: Form): Omit<TaskEdit, 'completed_at_ms'> | string {
  const estimate = form.estimate.trim();
  if (estimate && !/^\d+$/.test(estimate)) return 'The estimate is a whole number of minutes.';
  return {
    title: form.title.trim(),
    description: form.description,
    status: form.status,
    priority: form.priority,
    project_id: form.project_id || null,
    labels: encodeLabels(form.labels.split(',')),
    start_date: form.start_date || null,
    due_date: form.due_date || null,
    estimate_minutes: estimate ? Number(estimate) : null,
    critical: form.critical,
  };
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function TaskPanel({
  task,
  defaultProject,
  all,
  projects,
  planner,
  onSaved,
  onSubtask,
  onGone,
  onClose,
}: {
  task: PlannerTask | null;
  defaultProject: string | null;
  all: PlannerTask[];
  projects: Project[];
  planner: PlannerRepo;
  onSaved: (row: PlannerTask) => void;
  onSubtask: (row: PlannerTask) => void;
  onGone: (id: string) => void;
  onClose: () => void;
}) {
  const [base, setBase] = useState(task);
  const [form, setForm] = useState(() => toForm(task, defaultProject));
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ current: PlannerTask; mine: Record<string, unknown> } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [links, setLinks] = useState<Link[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [newSub, setNewSub] = useState('');
  const [newLink, setNewLink] = useState({ url: '', title: '' });
  const [comment, setComment] = useState('');

  const edit = toEdit(form);
  const changes: TaskEdit =
    base && typeof edit !== 'string'
      ? (() => {
          const diff: TaskEdit = diffFields<TaskEdit>(base, edit);
          return diff.status ? { ...diff, ...statusChange(base, diff.status, Date.now()) } : diff;
        })()
      : {};
  const dirty = base ? Object.keys(changes).length > 0 : form.title.trim() !== '';
  const subtasks = base ? sortTasks(all.filter((t) => t.parent_id === base.id), 'manual') : [];

  async function loadDetails(id: string) {
    try {
      const d = await planner.details(id);
      setLinks(d.links);
      setActivity(d.activity);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : 'Could not load links and comments.']);
    }
  }

  useEffect(() => {
    // Only when the panel opens; later loads follow saves.
    if (task) loadDetails(task.id);
  }, []);

  function patch(fields: Partial<Form>) {
    setForm((f) => ({ ...f, ...fields }));
    setMessage(null);
  }

  /// Runs a write and handles every outcome the same way.
  async function run<T>(action: () => Promise<SaveResult<T>>, onSaved: (row: T) => void, done?: string) {
    setBusy(true);
    setProblems([]);
    setMessage(null);
    try {
      const result = await action();
      if (result.status === 'saved') {
        onSaved(result.row);
        if (done) setMessage(done);
      } else if (result.status === 'invalid') setProblems(result.problems);
      else if (result.status === 'conflict') {
        const current = result.current as unknown;
        if (base && (current as PlannerTask).id === base.id) setConflict({ current: current as PlannerTask, mine: result.mine });
        else setProblems(['That changed on another device. Refresh and try again.']);
      } else setProblems(['That was deleted on another device.']);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : 'Something went wrong. Try again.']);
    } finally {
      setBusy(false);
    }
  }

  function applySaved(row: PlannerTask) {
    if (row.deleted_at_ms != null) return onGone(row.id);
    setBase(row);
    setForm(toForm(row, null));
    onSaved(row);
    loadDetails(row.id);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (typeof edit === 'string') return setProblems([edit]);
    if (!base) {
      const { title, ...rest } = edit;
      return run(() => planner.create({ title: title ?? '', ...rest }, all), applySaved, 'Task added.');
    }
    if (!dirty) return;
    return run(() => planner.update(base, changes), applySaved, 'Saved.');
  }

  return (
    <section className="editor" aria-label={base ? 'Task details' : 'New task'}>
      <header className="editor-head">
        <h2>{base ? 'Task' : 'New task'}</h2>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </header>

      <form onSubmit={save} className="stack">
        <fieldset disabled={busy} className="stack">
          <label className="field">
            <span>Title</span>
            <input value={form.title} maxLength={300} required autoFocus={!base} onChange={(e) => patch({ title: e.target.value })} />
          </label>

          <div className="grid2">
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => patch({ status: e.target.value as Status })}>
                {(['backlog', 'todo', 'doing', 'done', 'cancelled'] as const).map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={form.priority} onChange={(e) => patch({ priority: Number(e.target.value) })}>
                {priorityLabels.map((label, value) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>Project</span>
              <select value={form.project_id} onChange={(e) => patch({ project_id: e.target.value })}>
                <option value="">Inbox</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Estimate (minutes)</span>
              <input inputMode="numeric" value={form.estimate} onChange={(e) => patch({ estimate: e.target.value })} />
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>Start</span>
              <input type="date" value={form.start_date} onChange={(e) => patch({ start_date: e.target.value })} />
            </label>
            <label className="field">
              <span>Due</span>
              <input type="date" value={form.due_date} onChange={(e) => patch({ due_date: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>Labels (comma separated)</span>
            <input value={form.labels} onChange={(e) => patch({ labels: e.target.value })} />
          </label>

          <label className="check">
            <input type="checkbox" checked={form.critical} onChange={(e) => patch({ critical: e.target.checked })} />
            <span>Critical (listed first)</span>
          </label>

          <label className="field">
            <span>Description</span>
            <textarea rows={6} value={form.description} onChange={(e) => patch({ description: e.target.value })} />
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

        <div className="row">
          <button className="primary" disabled={busy || !dirty}>
            {base ? 'Save' : 'Add task'}
          </button>
          {base && (
            <button type="button" className="danger push" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
        {base && (
          <p className="muted small">
            Created {when(base.created_at_ms)}
            {base.completed_at_ms ? ` · ${base.status === 'cancelled' ? 'Cancelled' : 'Done'} ${when(base.completed_at_ms)}` : ''}
          </p>
        )}
      </form>

      {base && (
        <>
          <section className="sub" aria-label="Sub-tasks">
            <h3>Sub-tasks</h3>
            <ul className="steps">
              {subtasks.map((s) => (
                <li key={s.id}>
                  <input
                    type="checkbox"
                    aria-label={`Done: ${s.title}`}
                    checked={isClosed(s.status)}
                    disabled={busy}
                    onChange={() => run(() => planner.toggleSubtask(s), onSubtask)}
                  />
                  <span className={isClosed(s.status) ? 'task-title done' : ''}>{s.title}</span>
                  <button
                    type="button"
                    className="icon push"
                    aria-label={`Delete sub-task ${s.title}`}
                    disabled={busy}
                    onClick={() => run(() => planner.remove(s, []), () => onSubtask({ ...s, deleted_at_ms: Date.now() }))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                run(
                  () => planner.create({ title: newSub, parent_id: base.id, project_id: base.project_id }, all),
                  (row) => {
                    onSubtask(row);
                    setNewSub('');
                  },
                );
              }}
            >
              <input aria-label="New sub-task" placeholder="Add a sub-task" maxLength={300} value={newSub} onChange={(e) => setNewSub(e.target.value)} />
              <button disabled={busy || !newSub.trim()}>Add</button>
            </form>
          </section>

          <section className="sub" aria-label="Links">
            <h3>Links</h3>
            <ul className="link-list">
              {links.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.title || l.url}
                  </a>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Remove link ${l.title || l.url}`}
                    disabled={busy}
                    onClick={() => run(() => planner.removeLink(l), () => setLinks((list) => list.filter((x) => x.id !== l.id)))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="grid-link"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => planner.addLink(base.id, newLink.url, newLink.title),
                  () => {
                    setNewLink({ url: '', title: '' });
                    loadDetails(base.id);
                  },
                );
              }}
            >
              <input aria-label="Link address" placeholder="https://…" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
              <input aria-label="Link title" placeholder="Title (optional)" value={newLink.title} onChange={(e) => setNewLink({ ...newLink, title: e.target.value })} />
              <button disabled={busy || !newLink.url.trim()}>Add link</button>
            </form>
          </section>

          <section className="sub" aria-label="Activity">
            <h3>Activity</h3>
            <ul className="activity">
              {activity.map((a) => (
                <li key={a.id} className={a.kind === 'comment' ? 'comment' : 'history'}>
                  {a.kind === 'comment' ? <p className="note-body">{a.body}</p> : <span>{activityText(a, projects)}</span>}
                  <span className="muted small">{when(a.created_at_ms)}</span>
                </li>
              ))}
            </ul>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => planner.comment(base.id, comment),
                  (row) => {
                    setActivity((list) => [...list, row]);
                    setComment('');
                  },
                );
              }}
            >
              <textarea rows={2} aria-label="New comment" placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div>
                <button disabled={busy || !comment.trim()}>Comment</button>
              </div>
            </form>
          </section>
        </>
      )}

      {conflict && (
        <ConflictDialog
          current={conflict.current}
          mine={conflict.mine}
          projects={projects}
          onKeepTheirs={() => {
            applySaved(conflict.current);
            setConflict(null);
            setMessage('Showing the version saved on your other device.');
          }}
          onApplyMine={() => {
            const { current, mine } = conflict;
            setConflict(null);
            run(() => planner.update(current, mine as TaskEdit), applySaved, 'Saved.');
          }}
        />
      )}
      {confirmDelete && base && (
        <Confirm
          title="Delete this task?"
          body={<p>“{base.title}” and its sub-tasks will be removed here and from your phone the next time it syncs.</p>}
          action="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            run(() => planner.remove(base, subtasks), applySaved);
          }}
        />
      )}
    </section>
  );
}

