import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlannerRepo } from '../data/plannerRepo';
import {
  decodeLabels,
  isClosed,
  localIsoDate,
  priorityLabels,
  projectColor,
  projectColors,
  sortTasks,
  statusLabels,
  statuses,
  visibleTasks,
  type PlannerTask,
  type Project,
  type Scope,
  type Sort,
  type Status,
} from '../domain/planner';
import { plannerToCsv } from '../domain/plannerCsv';
import { Modal } from './Modal';
import { StatusButton } from './StatusButton';
import { TaskPanel } from './TaskPanel';

/// The phone's status-circle tap: to do → in progress → done → to do.
export function nextStatus(status: Status): Status {
  if (status === 'backlog' || status === 'todo') return 'doing';
  if (status === 'doing') return 'done';
  return 'todo';
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function sameScope(a: Scope, b: Scope): boolean {
  return typeof a === 'string' || typeof b === 'string' ? a === b : a.project === b.project;
}

export function PlannerWorkspace({
  email,
  planner,
  onSignOut,
}: {
  email: string;
  planner: PlannerRepo;
  onSignOut: () => void;
}) {
  const [tasks, setTasks] = useState<PlannerTask[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('manual');
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [panelKey, setPanelKey] = useState('');
  const [newProject, setNewProject] = useState<{ name: string; color: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await planner.load();
      setTasks(data.tasks);
      setProjects(data.projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your tasks.');
    }
  }, [planner]);

  useEffect(() => {
    load();
    // Pick up phone changes when coming back to this window.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = localIsoDate(new Date());
  const all = tasks ?? [];
  const shown = useMemo(() => visibleTasks(all, scope, search, today), [all, scope, search, today]);
  const groups = useMemo(
    () =>
      statuses
        .filter((s) => showClosed || !isClosed(s))
        .map((s) => ({ status: s, items: sortTasks(shown.filter((t) => t.status === s), sort) })),
    [shown, sort, showClosed],
  );
  const openCount = (s: Scope) => visibleTasks(all, s, '', today).filter((t) => !isClosed(t.status)).length;
  const current = selected && selected !== 'new' ? (all.find((t) => t.id === selected) ?? null) : null;
  const activeProjects = projects.filter((p) => !p.archived);

  const replace = (row: PlannerTask) =>
    setTasks((list) => {
      const rest = (list ?? []).filter((t) => t.id !== row.id);
      return row.deleted_at_ms == null ? [...rest, row] : rest;
    });

  function open(id: string | 'new') {
    setSelected(id);
    setPanelKey(id === 'new' ? `new-${Date.now()}` : id);
  }

  async function cycle(task: PlannerTask) {
    const result = await planner.setStatus(task, nextStatus(task.status));
    if (result.status === 'saved') replace(result.row);
    else if (result.status === 'conflict') {
      replace(result.current);
      setNotice(`“${result.current.title}” changed on another device. It now shows the latest version; try again.`);
    } else if (result.status === 'gone') {
      setTasks((list) => (list ?? []).filter((t) => t.id !== task.id));
      setNotice('That task was deleted on another device.');
    }
  }

  function exportCsv() {
    const csv = '﻿' + plannerToCsv(all, projects);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nindo-tasks-${today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const scopes: { scope: Scope; label: string }[] = [
    { scope: 'all', label: 'All tasks' },
    { scope: 'today', label: 'Today' },
    { scope: 'overdue', label: 'Overdue' },
    { scope: 'inbox', label: 'Inbox' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Nindo</strong> <span className="muted">Tasks</span>
        </div>
        <div className="account" aria-label="Signed in account">
          <span className="muted small">Signed in as</span> <strong>{email}</strong>
        </div>
        <div className="row">
          <button onClick={exportCsv} disabled={!all.length}>
            Export CSV
          </button>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Task lists">
          <button className="primary block" onClick={() => open('new')}>
            New task
          </button>
          <ul>
            {scopes.map(({ scope: s, label }) => (
              <li key={label}>
                <button
                  className={sameScope(s, scope) ? 'filter active' : 'filter'}
                  aria-current={sameScope(s, scope) ? 'true' : undefined}
                  onClick={() => setScope(s)}
                >
                  <span>{label}</span>
                  <span className="count">{openCount(s)}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="side-head">Projects</h3>
          <ul>
            {activeProjects.map((p) => {
              const s: Scope = { project: p.id };
              return (
                <li key={p.id}>
                  <button
                    className={sameScope(s, scope) ? 'filter active' : 'filter'}
                    aria-current={sameScope(s, scope) ? 'true' : undefined}
                    onClick={() => setScope(s)}
                  >
                    <span className="row tight">
                      <span className="swatch" data-color={p.color % projectColors.length} aria-hidden="true" />
                      {p.name}
                    </span>
                    <span className="count">{openCount(s)}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button className="filter muted" onClick={() => setNewProject({ name: '', color: 1 })}>
                + New project
              </button>
            </li>
          </ul>
        </nav>

        <main className="list-pane">
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search tasks"
              aria-label="Search tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="inline">
              <span className="muted small">Sort</span>
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="manual">Manual</option>
                <option value="priority">Priority</option>
                <option value="due">Due date</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              <span className="small">Show done</span>
            </label>
            <button onClick={load}>Refresh</button>
          </div>

          {notice && (
            <p className="banner" role="status">
              {notice}{' '}
              <button className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {tasks === null && !error && <p className="muted">Loading your tasks…</p>}
          {tasks !== null && all.length === 0 && (
            <p className="empty muted">
              No tasks yet. Open Nindo on your phone once so it uploads your Tasks, or add one here.
            </p>
          )}

          {tasks !== null &&
            groups.map(({ status, items }) =>
              items.length === 0 ? null : (
                <section key={status} className="group" aria-label={statusLabels[status]}>
                  <h2 className="group-head">
                    {statusLabels[status]} <span className="count">{items.length}</span>
                  </h2>
                  <ul className="tasks">
                    {items.map((task) => {
                      const subs = all.filter((s) => s.parent_id === task.id);
                      const project = projects.find((p) => p.id === task.project_id);
                      const overdue = !isClosed(task.status) && task.due_date !== null && task.due_date < today;
                      return (
                        <li key={task.id} className={task.id === selected ? 'task-row selected' : 'task-row'}>
                          <StatusButton status={task.status} title={task.title} onClick={() => cycle(task)} />
                          <button className="task-open" onClick={() => open(task.id)} aria-current={task.id === selected ? 'true' : undefined}>
                            <span className="task-main">
                              <span className={isClosed(task.status) ? 'task-title done' : 'task-title'}>
                                {task.critical && <span className="critical">Critical</span>} {task.title}
                              </span>
                              <span className="task-meta">
                                {task.priority > 0 && <span className={`prio p${task.priority}`}>{priorityLabels[task.priority]}</span>}
                                {project && (
                                  <span className="tag">
                                    <span className="swatch" data-color={project.color % projectColors.length} aria-hidden="true" />{' '}
                                    {project.name}
                                  </span>
                                )}
                                {task.due_date && (
                                  <span className={overdue ? 'overdue' : ''}>
                                    {overdue ? 'Overdue · ' : 'Due '}
                                    {dateLabel(task.due_date)}
                                  </span>
                                )}
                                {subs.length > 0 && (
                                  <span>
                                    {subs.filter((s) => s.status === 'done').length}/{subs.length} sub-tasks
                                  </span>
                                )}
                                {decodeLabels(task.labels).map((l) => (
                                  <span key={l} className="tag">
                                    #{l}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ),
            )}
          {tasks !== null && all.length > 0 && groups.every((g) => g.items.length === 0) && (
            <p className="empty muted">{search ? 'No tasks match that search.' : 'Nothing here.'}</p>
          )}
        </main>

        <aside className="detail-pane">
          {selected === 'new' || current ? (
            <TaskPanel
              key={panelKey}
              task={selected === 'new' ? null : current}
              defaultProject={typeof scope === 'object' ? scope.project : null}
              all={all}
              projects={projects}
              planner={planner}
              onSaved={(row) => {
                replace(row);
                setSelected(row.id);
              }}
              onSubtask={replace}
              onGone={(id) => {
                setTasks((list) => (list ?? []).filter((t) => t.id !== id && t.parent_id !== id));
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="muted empty">Pick a task to see all its details, or add a new one.</p>
          )}
        </aside>
      </div>

      <footer className="footer muted small">
        Changes appear on your phone the next time it opens or syncs. Files, photos and timers stay on your phone.
      </footer>

      {newProject && (
        <Modal title="New project" onClose={() => setNewProject(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await planner.createProject(newProject.name, newProject.color, projects);
              if (result.status === 'saved') {
                setProjects((list) => [...list, result.row]);
                setScope({ project: result.row.id });
                setNewProject(null);
              } else if (result.status === 'invalid') setNotice(result.problems.join(' '));
            }}
          >
            <label className="field">
              <span>Name</span>
              <input
                value={newProject.name}
                maxLength={80}
                required
                autoFocus
                onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              />
            </label>
            <div className="field">
              <span>Colour</span>
              <div className="row">
                {projectColors.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={newProject.color === i ? 'swatch-pick active' : 'swatch-pick'}
                    data-color={i}
                    aria-label={`Colour ${i + 1}`}
                    aria-pressed={newProject.color === i}
                    title={projectColor(i)}
                    onClick={() => setNewProject({ ...newProject, color: i })}
                  />
                ))}
              </div>
            </div>
            <div className="row end">
              <button type="button" onClick={() => setNewProject(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!newProject.name.trim()}>
                Add project
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
