import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerRepo, SaveResult } from '../data/plannerRepo';
import {
  decodeLabels,
  filterActive,
  groupByProject,
  isClosed,
  isOverdue,
  localIsoDate,
  noFilter,
  projectColors,
  sortTasks,
  statusLabels,
  statuses,
  visibleTasks,
  type Activity,
  type Filter,
  type PlannerTask,
  type Project,
  type Scope,
  type Sort,
  type Status,
} from '../domain/planner';
import { plannerToCsv } from '../domain/plannerCsv';
import { sessionsAsActivity, startOfLocalDay, weekStart, type TimeData } from '../domain/time';
import { useSettings } from '../settings';
import { Board } from './Board';
import { DailyPlanningCard, Highlights } from './Cards';
import { DayPlanner } from './DayPlanner';
import { bsLabel } from '../domain/bs';
import { AttendanceCard, BreaksCard, WeekInsights } from './TimeCards';
import { FilterDialog } from './FilterDialog';
import { BoardIcon, Chevron, Close, DayIcon, Download, Expand, FilterIcon, Gear, Leaf, ListIcon, Pause, Plus, Refresh, Search, SidebarIcon, Sliders, StatusIcon } from './Icons';
import { Modal } from './Modal';
import { Segmented } from './Segmented';
import { SettingsDialog } from './SettingsDialog';
import { TaskPanel } from './TaskPanel';
import { TaskTile } from './TaskTile';
import { Toast, type ToastMessage } from './Toast';
import { BreakCover, FullClock } from './Clocks';
import { useTimers } from './useTimers';
import { clockText, runningTimers, timerElapsed } from '../domain/clock';

/// The phone's status-circle tap: to do → in progress → done → to do.
export function nextStatus(status: Status): Status {
  if (status === 'backlog' || status === 'todo') return 'doing';
  if (status === 'doing') return 'done';
  return 'todo';
}

function sameScope(a: Scope, b: Scope): boolean {
  return typeof a === 'string' || typeof b === 'string' ? a === b : a.project === b.project;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type View = 'list' | 'board' | 'day';

const sidebarKey = 'nindo.desktop.sidebar';
const viewKey = 'nindo.desktop.view';

function lastView(): View {
  try {
    const v = localStorage.getItem(viewKey);
    return v === 'board' || v === 'day' ? v : 'list';
  } catch {
    return 'list';
  }
}

function rememberView(view: View) {
  try {
    localStorage.setItem(viewKey, view);
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}

function sidebarWasHidden(): boolean {
  try {
    return localStorage.getItem(sidebarKey) === 'hidden';
  } catch {
    return false;
  }
}

function rememberSidebar(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(sidebarKey, 'hidden');
    else localStorage.removeItem(sidebarKey);
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}

export function PlannerWorkspace({ email, planner, onSignOut }: { email: string; planner: PlannerRepo; onSignOut: () => void }) {
  const { num } = useSettings();
  const [tasks, setTasks] = useState<PlannerTask[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [time, setTime] = useState<TimeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('manual');
  const [filter, setFilter] = useState<Filter>(noFilter);
  const [view, setViewState] = useState<View>(lastView);
  const setView = (v: View) => {
    rememberView(v);
    setViewState(v);
  };
  const [collapsed, setCollapsed] = useState<Set<Status>>(() => new Set(['done', 'cancelled']));
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [panelKey, setPanelKey] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [quick, setQuick] = useState('');
  const [newProject, setNewProject] = useState<{ name: string; color: number } | null>(null);
  const [dialog, setDialog] = useState<'filter' | 'settings' | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [fullClock, setFullClock] = useState(false);
  const [sideHidden, setSideHidden] = useState(sidebarWasHidden);
  // Just hidden with the pointer still on it: no peek until the pointer leaves.
  const [noPeek, setNoPeek] = useState(false);
  /// The open task panel's "save what is typed"; resolves false to stay open.
  const saveOpenTask = useRef<(() => Promise<boolean>) | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const say = useCallback((text: string, action?: ToastMessage['action']) => setToast({ id: Date.now(), text, action }), []);
  const hideToast = useCallback(() => setToast(null), []);

  const load = useCallback(async () => {
    try {
      const [data, today, timeData] = await Promise.all([
        planner.load(),
        planner.activitySince(startOfToday()),
        planner.timeSince(startOfLocalDay(weekStart(localIsoDate(new Date())))),
      ]);
      setTasks(data.tasks);
      setProjects(data.projects);
      setActivity(today);
      setTime(timeData);
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

  const toggleSidebar = useCallback(() => {
    setSideHidden((hidden) => {
      rememberSidebar(!hidden);
      setNoPeek(!hidden);
      return !hidden;
    });
  }, []);

  /// Closes the task, saving edits first so a close never loses them.
  const closeTask = useCallback(async () => {
    const save = saveOpenTask.current;
    if (!save || (await save())) setSelected(null);
  }, []);

  useEffect(() => {
    // Desktop keys: N new task, / search, [ sidebar, Escape closes the task.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' && !typing) closeTask();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        quickRef.current?.focus();
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '[') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeTask, toggleSidebar]);

  const today = localIsoDate(new Date());
  const all = useMemo(() => tasks ?? [], [tasks]);
  const timers = useTimers({ planner, tasks: all, onLogged: load, say });
  const liveIds = runningTimers(timers.state);
  const runOf = (t: PlannerTask) => {
    const f = timers.state.focus;
    if (f && f.taskId === t.id && f.phase === 'focus') return { running: true, text: clockText(f.endsAt - timers.now) };
    const timer = timers.state.timers[t.id];
    if (!timer) return undefined;
    return { running: timer.startedAt != null, text: clockText(timerElapsed(timer, timers.now)) };
  };
  const shown = useMemo(() => sortTasks(visibleTasks(all, scope, search, today, filter), sort), [all, scope, search, today, filter, sort]);
  const byStatus = useMemo(() => {
    const out = {} as Record<Status, PlannerTask[]>;
    for (const s of statuses) out[s] = shown.filter((t) => t.status === s);
    return out;
  }, [shown]);
  const subtasksOf = useMemo(() => {
    const map = new Map<string, PlannerTask[]>();
    for (const t of all) if (t.parent_id) map.set(t.parent_id, [...(map.get(t.parent_id) ?? []), t]);
    return map;
  }, [all]);
  const todayStart = startOfToday();
  const doneToday = all.filter((t) => !t.parent_id && t.status === 'done' && (t.completed_at_ms ?? 0) >= todayStart).length;
  // The same count as the Day planner's ring: in progress, due today or overdue.
  const openToday = all.filter((t) => !t.parent_id && !isClosed(t.status) && (t.status === 'doing' || t.due_date === today || isOverdue(t, today))).length;
  const dayTotal = doneToday + openToday;
  const heroDate = new Date();
  const bsToday = bsLabel(today, num);
  // Real sessions replace the phone's focus/time history lines, which would
  // count the same minutes twice.
  const highlightActivity = useMemo(
    () => (time && time.sessions.length ? [...activity.filter((a) => a.kind !== 'focus' && a.kind !== 'time'), ...sessionsAsActivity(time.sessions)] : activity),
    [activity, time],
  );
  const openCount = (s: Scope) => visibleTasks(all, s, '', today).filter((t) => !isClosed(t.status)).length;
  const current = selected && selected !== 'new' ? (all.find((t) => t.id === selected) ?? null) : null;
  const activeProjects = projects.filter((p) => !p.archived);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const allLabels = [...new Set(all.filter((t) => !t.parent_id).flatMap((t) => decodeLabels(t.labels)))].sort();
  // Inside a status, tasks sit under their project unless one list is picked.
  const grouped = scope === 'all' || scope === 'today' || scope === 'overdue';

  const replace = (row: PlannerTask) =>
    setTasks((list) => {
      const rest = (list ?? []).filter((t) => t.id !== row.id);
      return row.deleted_at_ms == null ? [...rest, row] : rest;
    });

  async function open(id: string | 'new', title = '') {
    // Opening another task closes this one, which saves its edits.
    const save = saveOpenTask.current;
    if (save && (id !== selected || id === 'new') && !(await save())) return;
    setSelected(id);
    setNewTitle(title);
    setPanelKey(id === 'new' ? `new-${Date.now()}` : id);
  }

  /// Handles a write's result for a task in the list.
  function settle(result: SaveResult<PlannerTask>, task: PlannerTask): boolean {
    if (result.status === 'saved') {
      replace(result.row);
      return true;
    }
    if (result.status === 'conflict') {
      replace(result.current);
      say(`“${result.current.title}” changed on another device. It now shows the latest version; try again.`);
    } else if (result.status === 'gone') {
      setTasks((list) => (list ?? []).filter((t) => t.id !== task.id));
      say('That task was deleted on another device.');
    } else say(result.problems.join(' '));
    return false;
  }

  async function guarded<T = boolean | void>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      return undefined;
    }
  }

  const cycle = (task: PlannerTask, status: Status = nextStatus(task.status)) =>
    guarded(async () => {
      if (settle(await planner.setStatus(task, status), task)) load();
    });

  const create = (title: string, status: Status = 'todo') =>
    guarded(async () => {
      const project = typeof scope === 'object' ? scope.project : null;
      const result = await planner.create({ title, status, project_id: project }, all);
      if (result.status === 'saved') {
        replace(result.row);
        say('Task added.');
      } else if (result.status === 'invalid') say(result.problems.join(' '));
    });

  const move = (id: string, status: Status, beforeId: string | null) =>
    guarded(async () => {
      const task = all.find((t) => t.id === id);
      if (task) settle(await planner.move(task, status, beforeId, all), task);
    });

  function deleted(task: PlannerTask, subtasks: PlannerTask[]) {
    setTasks((list) => (list ?? []).filter((t) => t.id !== task.id && t.parent_id !== task.id));
    setSelected(null);
    say('Task deleted', {
      label: 'Undo',
      run: () =>
        guarded(async () => {
          const result = await planner.restore(task, subtasks);
          if (result.status === 'saved') {
            await load();
            open(task.id);
          } else say('That task could not be brought back.');
        }),
    });
  }

  async function checkInOut() {
    if (!time) return;
    const day = time.attendance.find((a) => a.id === today);
    const result = await guarded(() => planner.checkInOut(today, day, Date.now()));
    if (result?.status === 'saved') {
      say(day?.check_in_ms ? 'Checked out. See you tomorrow.' : 'Checked in. Have a good day.');
      await load();
    } else if (result?.status === 'already') say('You already checked out today.');
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

  const tile = (t: PlannerTask, inGroup: boolean, card = false) => (
    <TaskTile
      key={t.id}
      task={t}
      card={card}
      project={typeof scope === 'object' || inGroup ? undefined : projectById.get(t.project_id ?? '')}
      subtasks={subtasksOf.get(t.id) ?? []}
      today={today}
      selected={t.id === selected}
      onOpen={() => open(t.id)}
      onCycle={() => cycle(t)}
      run={runOf(t)}
      lead={!card}
      onToggleTimer={() => timers.toggle(t)}
    />
  );

  const groupHeader = (projectId: string | null, count: number) => {
    const p = projectId ? projectById.get(projectId) : undefined;
    return (
      <h3 className="group-head" key={`g-${projectId ?? 'inbox'}`}>
        <span className={p ? 'dot' : 'dot hollow'} data-color={p?.color} aria-hidden="true" />
        <span className="group-name">{p?.name ?? 'Inbox'}</span>
        <span className="count">{num(count)}</span>
      </h3>
    );
  };

  const scopes: { scope: Scope; label: string }[] = [
    { scope: 'all', label: 'All tasks' },
    { scope: 'today', label: 'Today' },
    { scope: 'overdue', label: 'Overdue' },
    { scope: 'inbox', label: 'Inbox' },
  ];
  const scopeTitle =
    typeof scope === 'object' ? (projectById.get(scope.project)?.name ?? 'Tasks') : scope === 'all' ? 'Tasks' : scopes.find((s) => s.scope === scope)!.label;
  const narrowed = filterActive(filter) || sort !== 'manual';

  return (
    <div className={['app', selected && 'with-task', sideHidden && 'side-hidden', noPeek && 'no-peek'].filter(Boolean).join(' ')}>
      {sideHidden && (
        <div className="side-rail" onPointerEnter={() => setNoPeek(false)}>
          <button className="icon-button side-toggle" aria-label="Show sidebar" title="Show sidebar ([)" aria-expanded="false" onClick={toggleSidebar}>
            <SidebarIcon size={20} />
          </button>
        </div>
      )}
      <nav className="sidebar" aria-label="Task lists">
        <div className="side-top">
          <div className="wordmark">
            Nindo <span className="kicker">Tasks</span>
          </div>
          {!sideHidden && (
            <button className="icon-button small side-toggle" aria-label="Hide sidebar" title="Hide sidebar ([)" aria-expanded="true" onClick={toggleSidebar}>
              <SidebarIcon />
            </button>
          )}
        </div>
        <ul className="nav-list">
          {scopes.map(({ scope: s, label }) => (
            <li key={label}>
              <button className={sameScope(s, scope) ? 'nav active' : 'nav'} aria-current={sameScope(s, scope) ? 'true' : undefined} onClick={() => setScope(s)}>
                <span>{label}</span>
                <span className="count">{num(openCount(s))}</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="kicker side-head">Projects</h2>
        <ul className="nav-list">
          {activeProjects.map((p) => {
            const s: Scope = { project: p.id };
            return (
              <li key={p.id}>
                <button className={sameScope(s, scope) ? 'nav active' : 'nav'} aria-current={sameScope(s, scope) ? 'true' : undefined} onClick={() => setScope(s)}>
                  <span className="nav-name">
                    <span className="dot" data-color={p.color} aria-hidden="true" />
                    {p.name}
                  </span>
                  <span className="count">{num(openCount(s))}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button className="nav add" onClick={() => setNewProject({ name: '', color: 1 })}>
              <span className="nav-name">
                <Plus size={14} /> New project
              </span>
            </button>
          </li>
        </ul>
        <div className="side-foot">
          <button className="nav" onClick={() => setDialog('settings')}>
            <span className="nav-name">
              <Gear size={16} /> Settings
            </span>
          </button>
          <p className="muted small side-email" title={email} aria-label="Signed in account">
            {email}
          </p>
        </div>
      </nav>

      <main className="list-pane" onPointerEnter={() => setNoPeek(false)}>
        <header className="hero">
          <div className="hero-date" role="group" aria-label={`Today, ${heroDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${bsToday ? `, ${bsToday}` : ''}`}>
            <span className="hero-day" aria-hidden="true">
              {num(String(heroDate.getDate()))}
            </span>
            <span className="hero-words" aria-hidden="true">
              <span className="kicker">{heroDate.toLocaleDateString('en-GB', { weekday: 'long' })} · Today</span>
              <span className="hero-month">{heroDate.toLocaleDateString('en-GB', { month: 'long' })}</span>
              {bsToday && <span className="hero-bs">{bsToday}</span>}
            </span>
          </div>
          <div className="hero-actions">
            {dayTotal > 0 && (
              <div className="hero-progress" role="img" aria-label={`${doneToday} of ${dayTotal} done today`}>
                <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r="16" className="ring-track" strokeWidth="4" />
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    className="ring-fill done"
                    strokeWidth="4"
                    strokeDasharray={`${(2 * Math.PI * 16 * doneToday) / dayTotal} 200`}
                    transform="rotate(-90 20 20)"
                  />
                </svg>
                <span className="hero-progress-text">
                  <b>{num(`${doneToday} of ${dayTotal}`)}</b>
                  <span className="muted small">done today</span>
                </span>
              </div>
            )}
            <button className="secondary break-button" onClick={timers.takeBreak} title="Take a break: pauses your timers">
              <Leaf size={18} /> Take a break
            </button>
            <button className="primary" onClick={() => open('new')} title="New task with every detail">
              <Plus size={18} /> New task
            </button>
          </div>
        </header>

        {(liveIds.length > 0 || timers.state.focus) && (
          <div className="running-bar" role="status" aria-label="Running timers">
            <span className="pulse" aria-hidden="true" />
            <span className="running-words">
              <span className="kicker acc-ink">{timers.state.focus ? (timers.state.focus.phase === 'focus' ? 'Focus round' : 'Rest') : liveIds.length > 1 ? `${num(liveIds.length)} timers running` : 'Running now'}</span>
              <span className="running-title">
                {timers.state.focus ? timers.state.focus.title : liveIds.length === 1 ? (all.find((t) => t.id === liveIds[0])?.title ?? 'Task') : liveIds.map((id) => all.find((t) => t.id === id)?.title ?? 'Task').join(' · ')}
              </span>
            </span>
            <span className="running-clock">
              {num(
                clockText(
                  timers.state.focus
                    ? timers.state.focus.endsAt - timers.now
                    : Math.max(...liveIds.map((id) => timerElapsed(timers.state.timers[id], timers.now))),
                ),
              )}
            </span>
            {liveIds.length > 0 && (
              <button className="round-button acc" aria-label={liveIds.length > 1 ? 'Pause all timers' : 'Pause timer'} title={liveIds.length > 1 ? 'Pause all' : 'Pause'} onClick={timers.pauseAll}>
                <Pause size={16} />
              </button>
            )}
            <button className="round-button" aria-label="Full screen" title="Full screen" onClick={() => setFullClock(true)}>
              <Expand size={16} />
            </button>
          </div>
        )}

        <div className="page-head">
          <h1 className="page-title">{view === 'day' ? 'Day planner' : scopeTitle}</h1>
          <div className="head-actions">
            <Segmented<View>
              label="View"
              value={view}
              options={[
                { value: 'list', label: <ListIcon size={18} />, title: 'List' },
                { value: 'board', label: <BoardIcon size={18} />, title: 'Board' },
                { value: 'day', label: <DayIcon size={18} />, title: 'Day planner' },
              ]}
              onChange={setView}
            />
            <button className="icon-button" aria-label="Refresh" title="Refresh" onClick={load}>
              <Refresh />
            </button>
            <button className="icon-button" aria-label="Export CSV" title="Export CSV" onClick={exportCsv} disabled={!all.length}>
              <Download />
            </button>
          </div>
        </div>
        <DailyPlanningCard
          tasks={all}
          activity={activity}
          today={today}
          onStart={(t) =>
            guarded(async () => {
              if (settle(await planner.setStatus(t, 'doing'), t)) {
                say(`Daily planning started at ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
                load();
              }
            })
          }
          onFinish={(t) =>
            guarded(async () => {
              if (settle(await planner.setStatus(t, 'done'), t)) {
                say('Daily planning done');
                load();
              }
            })
          }
        />

        {view !== 'day' && (
          <div className="add-line">
            <form
              className="add-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!quick.trim()) return;
                create(quick.trim());
                setQuick('');
              }}
            >
              <Plus size={20} className="acc-ink" />
              <input ref={quickRef} aria-label="Add a task" placeholder="Add a task" maxLength={300} value={quick} onChange={(e) => setQuick(e.target.value)} />
              <span className="key-hint muted small" aria-hidden="true">
                N
              </span>
              <button
                type="button"
                className="icon-button small"
                aria-label="Add with details"
                title="Add with every detail"
                onClick={() => {
                  open('new', quick);
                  setQuick('');
                }}
              >
                <Sliders className="acc-ink" />
              </button>
            </form>
            <label className="search-inline">
              <Search size={16} className="muted" />
              <input ref={searchRef} type="search" aria-label="Search tasks" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button className="icon-button" aria-label="Filter" title="Filter and sort" onClick={() => setDialog('filter')}>
              <FilterIcon on={narrowed} size={22} />
            </button>
          </div>
        )}

        {view !== 'day' && (filterActive(filter) || sort !== 'manual') && (
          <div className="chips">
            <button className="chip on" aria-pressed="true" onClick={() => (setFilter(noFilter), setSort('manual'))}>
              Filtered <Close size={12} />
            </button>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tasks === null && !error && <p className="muted">Loading your tasks…</p>}
        {tasks !== null && shown.length === 0 && view !== 'day' && (
          <p className="empty muted">
            {all.some((t) => !t.parent_id) ? 'No tasks match.' : 'No tasks here yet. Add one above, or open Nindo on your phone once so it uploads your tasks.'}
          </p>
        )}

        {tasks !== null && shown.length > 0 && view === 'list' && (
          <div className="sections">
            {statuses.map((s) => {
              const items = byStatus[s];
              if (!items.length) return null;
              const shut = collapsed.has(s);
              return (
                <section key={s} className="status-section" aria-label={statusLabels[s]}>
                  <h2 className="section-head">
                    <button
                      className="section-toggle"
                      aria-expanded={!shut}
                      onClick={() =>
                        setCollapsed((c) => {
                          const next = new Set(c);
                          if (!next.delete(s)) next.add(s);
                          return next;
                        })
                      }
                    >
                      <span className={`s-${s}`}>
                        <StatusIcon status={s} size={16} />
                      </span>
                      <span className="kicker">{statusLabels[s]}</span>
                      <span className="count">{num(items.length)}</span>
                      <Chevron up={!shut} size={14} className="push muted" />
                    </button>
                  </h2>
                  {!shut &&
                    (grouped ? (
                      groupByProject(items, projects).map((g) => (
                        <div key={g.projectId ?? 'inbox'}>
                          {groupHeader(g.projectId, g.tasks.length)}
                          <ul className="ruled">
                            {g.tasks.map((t, i) => (
                              <li key={t.id} style={{ ['--i' as string]: i }}>{tile(t, true)}</li>
                            ))}
                          </ul>
                        </div>
                      ))
                    ) : (
                      <ul className="ruled">
                        {items.map((t, i) => (
                          <li key={t.id} style={{ ['--i' as string]: i }}>{tile(t, false)}</li>
                        ))}
                      </ul>
                    ))}
                </section>
              );
            })}
          </div>
        )}

        {tasks !== null && shown.length > 0 && view === 'board' && (
          <Board
            columns={byStatus}
            projects={projects}
            grouped={grouped}
            groupHeader={groupHeader}
            tile={(t) => tile(t, grouped, true)}
            onMove={move}
            onAdd={(status, title) => create(title, status)}
          />
        )}

        {tasks !== null && view === 'day' && (
          <DayPlanner
            tasks={all}
            projects={projects}
            time={time}
            timers={timers}
            today={today}
            attendance={time?.attendance.find((a) => a.id === today)}
            onOpen={(id) => open(id)}
            onCheck={checkInOut}
          />
        )}

        {tasks !== null && view !== 'day' && (
          <Highlights tasks={all} activity={highlightActivity} projects={projects} dayStart={startOfToday()} onOpen={(id) => open(id)} />
        )}
        {time && <BreaksCard data={time} today={today} />}
        {time && view !== 'day' && (
          <AttendanceCard
            data={time}
            today={today}
            onCheck={checkInOut}
            onSave={async (day, values) => {
              const result = await guarded(() => planner.saveAttendance(day, values));
              if (result?.status === 'saved') {
                say('Attendance saved.');
                await load();
                return null;
              }
              if (!result) return 'Something went wrong. Try again.';
              return result.status === 'invalid' ? result.problems.join(' ') : 'That day changed on another device. Try again.';
            }}
          />
        )}
        {time && <WeekInsights data={time} today={today} />}

        <p className="muted small foot-note">
          Changes reach your phone the next time it opens or syncs. Timers run on this computer; the time they log syncs. Files and photos stay on your phone.
        </p>
      </main>

      <aside className={selected ? 'detail-pane open' : 'detail-pane'} aria-label="Task" hidden={!selected}>
        {(selected === 'new' || current) && (
          <TaskPanel
            key={panelKey}
            task={selected === 'new' ? null : current}
            initialTitle={newTitle}
            defaultProject={typeof scope === 'object' ? scope.project : null}
            all={all}
            projects={projects}
            planner={planner}
            onToast={say}
            onSaved={(row) => {
              replace(row);
              setSelected(row.id);
              load();
            }}
            onSubtask={replace}
            onDuplicated={(row) => {
              load();
              open(row.id);
            }}
            onDeleted={deleted}
            onGone={(id) => {
              setTasks((list) => (list ?? []).filter((t) => t.id !== id && t.parent_id !== id));
              setSelected(null);
            }}
            onClose={closeTask}
            onDiscard={() => setSelected(null)}
            saveRef={saveOpenTask}
            timers={timers}
            onFullScreen={() => setFullClock(true)}
            onTimeChanged={load}
          />
        )}
      </aside>

      {dialog === 'filter' && (
        <FilterDialog
          filter={filter}
          sort={sort}
          labels={allLabels}
          onClose={() => setDialog(null)}
          onApply={(f, s) => {
            setFilter(f);
            setSort(s);
            if (f.showClosed !== filter.showClosed && f.showClosed) setCollapsed(new Set());
            setDialog(null);
          }}
        />
      )}
      {dialog === 'settings' && <SettingsDialog email={email} onSignOut={onSignOut} onClose={() => setDialog(null)} />}

      {newProject && (
        <Modal title="New project" onClose={() => setNewProject(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              guarded(async () => {
                const result = await planner.createProject(newProject.name, newProject.color, projects);
                if (result.status === 'saved') {
                  setProjects((list) => [...list, result.row]);
                  setScope({ project: result.row.id });
                  setNewProject(null);
                } else if (result.status === 'invalid') say(result.problems.join(' '));
              });
            }}
          >
            <label className="field">
              <span className="kicker">Name</span>
              <input value={newProject.name} maxLength={80} required autoFocus onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} />
            </label>
            <div className="field">
              <span className="kicker">Colour</span>
              <div className="swatches" role="radiogroup" aria-label="Colour">
                {projectColors.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    className="swatch-pick"
                    aria-label={`Colour ${i + 1}`}
                    aria-checked={newProject.color === i}
                    onClick={() => setNewProject({ ...newProject, color: i })}
                  >
                    <span className="swatch-fill dot-fill" data-color={i} />
                  </button>
                ))}
              </div>
            </div>
            <div className="row end">
              <button type="button" className="secondary" onClick={() => setNewProject(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!newProject.name.trim()}>
                Add project
              </button>
            </div>
          </form>
        </Modal>
      )}

      <BreakCover timers={timers} tasks={all} />
      {fullClock && <FullClock timers={timers} tasks={all} onClose={() => setFullClock(false)} />}
      <Toast toast={toast} onDone={hideToast} />
    </div>
  );
}
