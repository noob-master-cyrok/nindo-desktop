import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
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
  statuses,
  statusLabels,
  type Activity,
  type Link,
  type PlannerTask,
  type Project,
  type Status,
  type TaskEdit,
} from '../domain/planner';
import { ConflictDialog } from './ConflictDialog';
import { Close, Copy, LinkIcon, PriorityIcon, StatusIcon, Trash } from './Icons';
import { Picker } from './Picker';
import { TimePanel } from './TimePanel';
import type { Timers } from './useTimers';

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

function toForm(task: PlannerTask | null, defaultProject: string | null, title = ''): Form {
  return {
    title: task?.title ?? title,
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

/// Grows a text box to fit what is typed.
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

/// Labels as chips, like the phone: Enter or a comma adds one, × removes it.
function LabelsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const labels = value.split(',').map((l) => l.trim()).filter(Boolean);
  const add = () => {
    const l = draft.trim().replace(/,/g, ' ');
    if (l && !labels.includes(l)) onChange([...labels, l].join(', '));
    setDraft('');
  };
  return (
    <div className="field">
      <span id="labels-label">Labels</span>
      <div className="label-field">
        {labels.map((l) => (
          <span key={l} className="label-chip big">
            {l}
            <button type="button" className="chip-x" aria-label={`Remove label ${l}`} onClick={() => onChange(labels.filter((x) => x !== l).join(', '))}>
              <Close size={11} />
            </button>
          </span>
        ))}
        <input
          aria-labelledby="labels-label"
          placeholder={labels.length ? 'Add' : 'Add a label'}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(',') ? (setDraft(e.target.value.slice(0, -1)), setTimeout(add)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && labels.length) onChange(labels.slice(0, -1).join(', '));
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function TaskPanel({
  task,
  initialTitle = '',
  defaultProject,
  all,
  projects,
  planner,
  onToast,
  onSaved,
  onSubtask,
  onDuplicated,
  onDeleted,
  onGone,
  onClose,
  onDiscard,
  saveRef,
  timers,
  onFullScreen,
  onTimeChanged,
}: {
  task: PlannerTask | null;
  /// What was typed in quick add before opening the full window.
  initialTitle?: string;
  defaultProject: string | null;
  all: PlannerTask[];
  projects: Project[];
  planner: PlannerRepo;
  onToast: (text: string) => void;
  onSaved: (row: PlannerTask) => void;
  onSubtask: (row: PlannerTask) => void;
  onDuplicated: (row: PlannerTask) => void;
  /// Deleted with its sub-tasks; the page offers Undo.
  onDeleted: (task: PlannerTask, subtasks: PlannerTask[]) => void;
  onGone: (id: string) => void;
  /// Asks to close; the page saves through saveRef first.
  onClose: () => void;
  /// Closes and drops what is typed.
  onDiscard: () => void;
  /// Filled with "save what is typed", which the page runs before closing.
  saveRef: RefObject<(() => Promise<boolean>) | null>;
  timers: Timers;
  onFullScreen: () => void;
  onTimeChanged: () => void;
}) {
  const [base, setBase] = useState(task);
  const [form, setForm] = useState(() => toForm(task, defaultProject, initialTitle));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ current: PlannerTask; mine: Record<string, unknown> } | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [newSub, setNewSub] = useState('');
  const [newLink, setNewLink] = useState({ url: '', title: '' });
  const [comment, setComment] = useState('');
  // Closes that tried to save and could not; then the panel offers to close
  // without saving, and shows why next to the Save button.
  const [closeFailed, setCloseFailed] = useState(0);
  const unsavedRef = useRef<HTMLDivElement>(null);

  const edit = toEdit(form);
  const changes: TaskEdit =
    base && typeof edit !== 'string'
      ? (() => {
          const diff: TaskEdit = diffFields<TaskEdit>(base, edit);
          return diff.status ? { ...diff, ...statusChange(base, diff.status, Date.now()) } : diff;
        })()
      : {};
  // A value that cannot be saved still counts as an edit, so a close shows why.
  const dirty = base ? typeof edit === 'string' || Object.keys(changes).length > 0 : form.title.trim() !== '';
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

  // The task changed elsewhere (a timer moved it on, or the phone synced):
  // take the new version while nothing here is unsaved.
  useEffect(() => {
    if (task && base && task.id === base.id && task.revision !== base.revision && !dirty) {
      setBase(task);
      setForm(toForm(task, null));
      loadDetails(task.id);
    }
  }, [task?.revision]);

  function patch(fields: Partial<Form>) {
    setForm((f) => ({ ...f, ...fields }));
  }

  /// Runs a write and handles every outcome the same way.
  async function run<T>(action: () => Promise<SaveResult<T>>, onSaved: (row: T) => void, done?: string): Promise<boolean> {
    setBusy(true);
    setProblems([]);
    try {
      const result = await action();
      if (result.status === 'saved') {
        onSaved(result.row);
        if (done) onToast(done);
        return true;
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
    return false;
  }

  function applySaved(row: PlannerTask) {
    if (row.deleted_at_ms != null) return onGone(row.id);
    setBase(row);
    setForm(toForm(row, null));
    onSaved(row);
    loadDetails(row.id);
  }

  /// Saves what is typed; true when nothing is left unsaved.
  async function saveForm(saved: string): Promise<boolean> {
    if (!dirty) return true;
    if (typeof edit === 'string') {
      setProblems([edit]);
      return false;
    }
    if (!base) {
      const { title, ...rest } = edit;
      return run(() => planner.create({ title: title ?? '', ...rest }, all), applySaved, 'Task added.');
    }
    return run(() => planner.update(base, changes), applySaved, saved);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    saveForm('Saved.');
  }

  // Closing without Save keeps the edits: the page saves through this first.
  // A problem or a conflict keeps the panel open to show it.
  useEffect(() => {
    const saveOnClose = async () => {
      if (!dirty) return true;
      if (busy || conflict) return false;
      const ok = await saveForm('Changes saved.');
      setCloseFailed((n) => (ok ? 0 : n + 1));
      return ok;
    };
    saveRef.current = saveOnClose;
    return () => {
      if (saveRef.current === saveOnClose) saveRef.current = null;
    };
  });

  useEffect(() => {
    if (closeFailed) unsavedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [closeFailed]);

  // Leaving or reloading the page cannot wait for a save, so ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <section className="editor" aria-label={base ? 'Task details' : 'New task'}>
      <header className="editor-head">
        <h2 className="sheet-title">{base ? 'Task' : 'New task'}</h2>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Close />
        </button>
      </header>

      {base && (
        <TimePanel task={task && task.id === base.id ? task : base} planner={planner} timers={timers} onFullScreen={onFullScreen} onToast={onToast} onChanged={onTimeChanged} />
      )}

      <form onSubmit={save} className="stack">
        <fieldset disabled={busy} className="stack">
          <label className="field">
            <span>Title</span>
            <textarea
              className="title-input"
              rows={1}
              value={form.title}
              maxLength={300}
              required
              autoFocus={!base}
              ref={grow}
              onChange={(e) => {
                patch({ title: e.target.value.replace(/\n/g, ' ') });
                grow(e.currentTarget);
              }}
              onKeyDown={(e) => {
                // Enter saves, as in a one-line field.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>

          <div className="grid2">
            <Picker<Status>
              label="Status"
              value={form.status}
              options={statuses.map((v) => ({ value: v, label: statusLabels[v], icon: <span className={`s-${v}`}><StatusIcon status={v} size={18} /></span> }))}
              onChange={(status) => patch({ status })}
            />
            <Picker<number>
              label="Priority"
              value={form.priority}
              options={[4, 3, 2, 1, 0].map((v) => ({ value: v, label: priorityLabels[v]!, icon: <PriorityIcon priority={v} size={16} /> }))}
              onChange={(priority) => patch({ priority })}
            />
          </div>

          <div className="grid2">
            <Picker<string>
              label="Project"
              value={form.project_id}
              options={[
                { value: '', label: 'Inbox', icon: <span className="dot hollow" /> },
                ...projects
                  .filter((p) => !p.archived || p.id === form.project_id)
                  .map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name, icon: <span className="dot" data-color={p.color} /> })),
              ]}
              onChange={(project_id) => patch({ project_id })}
            />
            <label className="field">
              <span>Estimate</span>
              <span className="suffix-field">
                <input inputMode="numeric" aria-label="Estimate (minutes)" placeholder="None" value={form.estimate} onChange={(e) => patch({ estimate: e.target.value })} />
                <span className="suffix muted">min</span>
              </span>
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

          <LabelsField value={form.labels} onChange={(labels) => patch({ labels })} />

          <label className="switch-row">
            <span>
              Critical
              <br />
              <span className="muted small">Listed first, and on Critical today</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={form.critical} onChange={(e) => patch({ critical: e.target.checked })} />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={4}
              ref={grow}
              placeholder="Write the details, steps, decisions…"
              value={form.description}
              onChange={(e) => {
                patch({ description: e.target.value });
                grow(e.currentTarget);
              }}
            />
          </label>
        </fieldset>

        <div ref={unsavedRef} className="stack close-area">
          {problems.length > 0 && (
            <ul className="error" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {closeFailed > 0 && dirty && !busy && (
            <p className="close-unsaved muted small">
              Your changes are not saved yet.{' '}
              <button type="button" className="text" onClick={onDiscard}>
                Close without saving
              </button>
            </p>
          )}
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !dirty}>
            {base ? 'Save' : 'Add task'}
          </button>
          {base && (
            <>
              <button
                type="button"
                className="secondary push"
                disabled={busy}
                onClick={() => run(() => planner.duplicate(base, all), onDuplicated, 'Task duplicated.')}
              >
                <Copy size={16} /> Duplicate
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(
                    () => planner.remove(base, subtasks),
                    () => onDeleted(base, subtasks),
                  )
                }
              >
                <Trash size={16} /> Delete
              </button>
            </>
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
            <h3 className="kicker">Sub-tasks</h3>
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
                    className="icon-button small push"
                    aria-label={`Delete sub-task ${s.title}`}
                    disabled={busy}
                    onClick={() => run(() => planner.remove(s, []), () => onSubtask({ ...s, deleted_at_ms: Date.now() }))}
                  >
                    <Close size={14} />
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
              <button className="secondary" disabled={busy || !newSub.trim()}>Add</button>
            </form>
          </section>

          <section className="sub" aria-label="Links">
            <h3 className="kicker">Links</h3>
            <ul className="link-list">
              {links.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    <LinkIcon size={14} /> {l.title || l.url}
                  </a>
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={`Remove link ${l.title || l.url}`}
                    disabled={busy}
                    onClick={() => run(() => planner.removeLink(l), () => setLinks((list) => list.filter((x) => x.id !== l.id)))}
                  >
                    <Close size={14} />
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
              <button className="secondary" disabled={busy || !newLink.url.trim()}>Add link</button>
            </form>
          </section>

          <section className="sub" aria-label="Activity">
            <h3 className="kicker">Activity</h3>
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
                <button className="secondary" disabled={busy || !comment.trim()}>Comment</button>
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
            onToast('Showing the version saved on your other device.');
          }}
          onApplyMine={() => {
            const { current, mine } = conflict;
            setConflict(null);
            run(() => planner.update(current, mine as TaskEdit), applySaved, 'Saved.');
          }}
        />
      )}
    </section>
  );
}

