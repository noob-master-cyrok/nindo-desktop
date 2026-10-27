import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NotesRepo } from '../data/notesRepo';
import type { TasksRepo } from '../data/tasksRepo';
import { tasksToCsv } from '../domain/csv';
import { counts, filterLabels, filters, relativeTime, visibleTasks, type Filter, type Sort } from '../domain/filters';
import { isReadOnly, isRepeating, localIsoDate, urgencyLabels, type TaskRow } from '../domain/task';
import { ImportDialog } from './ImportDialog';
import { TaskEditor } from './TaskEditor';

const PAGE = 100;

function dateLabel(task: TaskRow): string {
  if (task.undated) return 'No date';
  const [y, m, d] = task.due_date_ad.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return task.due_time ? `${date} · ${task.due_time}` : date;
}

export function Workspace({
  email,
  tasks,
  notes,
  onSignOut,
}: {
  email: string;
  tasks: TasksRepo;
  notes: NotesRepo;
  onSignOut: () => void;
}) {
  const [all, setAll] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('today');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  // Stays the same when a new task is first saved, so the editor (and its
  // "Task added" message) is not rebuilt.
  const [editorKey, setEditorKey] = useState('');
  const [importing, setImporting] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      setAll(await tasks.listAll());
      setError(null);
      setLoadedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your tasks.');
    }
  }, [tasks]);

  useEffect(() => {
    load();
    // Pick up phone changes when coming back to this window.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = localIsoDate(new Date());
  const shown = useMemo(() => visibleTasks(all ?? [], filter, search, sort, today), [all, filter, search, sort, today]);
  const tally = useMemo(() => counts(all ?? [], today), [all, today]);
  const current = selected && selected !== 'new' ? (all?.find((t) => t.id === selected) ?? null) : null;

  function upsert(row: TaskRow) {
    setAll((list) => {
      const rest = (list ?? []).filter((t) => t.id !== row.id);
      return row.deleted_at_ms == null ? [...rest, row] : rest;
    });
    setSelected(row.id);
  }

  function exportCsv() {
    const csv = '﻿' + tasksToCsv(all ?? []);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nindo-tasks-${today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Nindo</strong> <span className="muted">Desktop</span>
        </div>
        <div className="account" aria-label="Signed in account">
          <span className="muted small">Signed in as</span> <strong>{email}</strong>
        </div>
        <div className="row">
          <button onClick={() => setImporting(true)}>Import CSV</button>
          <button onClick={exportCsv} disabled={!all?.length}>
            Export CSV
          </button>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Filters">
          <button
            className="primary block"
            onClick={() => {
              setSelected('new');
              setEditorKey(`new-${Date.now()}`);
            }}
          >
            New task
          </button>
          <ul>
            {filters.map((f) => (
              <li key={f}>
                <button
                  className={f === filter ? 'filter active' : 'filter'}
                  aria-current={f === filter ? 'true' : undefined}
                  onClick={() => {
                    setFilter(f);
                    setLimit(PAGE);
                  }}
                >
                  <span>{filterLabels[f]}</span>
                  <span className="count">{tally[f]}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="list-pane">
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search titles"
              aria-label="Search titles"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="inline">
              <span className="muted small">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="due">Due date</option>
                <option value="urgency">Urgency</option>
              </select>
            </label>
            <button onClick={load} title={loadedAt ? `Loaded ${relativeTime(new Date(loadedAt).toISOString(), Date.now())}` : undefined}>
              Refresh
            </button>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {all === null && !error && <p className="muted">Loading your tasks…</p>}
          {all !== null && shown.length === 0 && (
            <p className="empty muted">{search ? 'No tasks match that search.' : `Nothing in ${filterLabels[filter]}.`}</p>
          )}

          <ul className="tasks">
            {shown.slice(0, limit).map((task) => {
              const overdue = !task.completed_at_ms && !task.undated && task.due_date_ad < today;
              return (
                <li key={task.id}>
                  <button
                    className={task.id === selected ? 'task selected' : 'task'}
                    onClick={() => {
                      setSelected(task.id);
                      setEditorKey(task.id);
                    }}
                    aria-current={task.id === selected ? 'true' : undefined}
                  >
                    <span className={`dot u${task.urgency}`} aria-hidden="true" />
                    <span className="task-main">
                      <span className={task.completed_at_ms ? 'task-title done' : 'task-title'}>{task.title}</span>
                      <span className="task-meta">
                        <span className={overdue ? 'overdue' : ''}>
                          {overdue && 'Overdue · '}
                          {dateLabel(task)}
                        </span>
                        {task.urgency >= 2 && <span className="tag">{urgencyLabels[task.urgency]}</span>}
                        {task.category && <span className="tag">{task.category}</span>}
                        {isRepeating(task) && <span className="tag">Repeats</span>}
                        {isReadOnly(task) && <span className="tag">Google</span>}
                        {task.steps.length > 0 && (
                          <span>
                            {task.steps.filter((s) => s.done).length}/{task.steps.length} steps
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="changed muted small" title="Last changed">
                      {relativeTime(task.server_updated_at, Date.now())}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {shown.length > limit && (
            <button className="block" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({shown.length - limit} left)
            </button>
          )}
        </main>

        <aside className="detail-pane">
          {selected === 'new' || current ? (
            <TaskEditor
              key={editorKey}
              task={selected === 'new' ? null : current}
              tasks={tasks}
              notes={notes}
              onSaved={upsert}
              onGone={(id) => {
                setAll((list) => (list ?? []).filter((t) => t.id !== id));
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="muted empty">Pick a task to see and edit it, or add a new one.</p>
          )}
        </aside>
      </div>

      <footer className="footer muted small">
        Changes appear on your phone the next time it opens or syncs. Timers, Planner and XP stay on your phone.
      </footer>

      {importing && (
        <ImportDialog
          tasks={tasks}
          onImported={(rows) => setAll((list) => [...(list ?? []), ...rows])}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}
