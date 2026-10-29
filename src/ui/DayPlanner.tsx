import { useMemo, useState } from 'react';
import { bsLabel } from '../domain/bs';
import { clockText, timerElapsed } from '../domain/clock';
import { durationLabel, isClosed, isOverdue, type PlannerTask, type Project } from '../domain/planner';
import { daysFrom, startOfLocalDay, weekStart, weekTime, type AttendanceDay, type TimeData } from '../domain/time';
import { useSettings } from '../settings';
import { Leaf, Pause, Play } from './Icons';
import type { Timers } from './useTimers';

const hourPx = 60;

interface Block {
  key: string;
  kind: 'work' | 'live' | 'break';
  taskId: string | null;
  title: string;
  color?: number;
  from: number;
  to: number;
  /// A focus round's planned end, drawn dashed past now.
  plannedTo?: number;
  lane: number;
  lanes: number;
}

function clockTime(ms: number, num: (v: string) => string): string {
  return num(new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
}

/// Places each block in the first lane that is free when it starts, so
/// overlapping work sits side by side; blocks that overlap nothing keep the
/// full width.
function laneOut(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const out: Block[] = [];
  let cluster: Block[] = [];
  let ends: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const b of cluster) b.lanes = Math.max(1, ends.length);
    cluster = [];
    ends = [];
  };
  for (const b of [...blocks].sort((a, b) => a.from - b.from)) {
    if (b.from >= clusterEnd) close();
    let lane = ends.findIndex((end) => end <= b.from);
    if (lane < 0) lane = ends.length;
    const end = Math.max(b.to, b.plannedTo ?? 0, b.from + 26 * 60_000);
    ends[lane] = end;
    clusterEnd = Math.max(clusterEnd, end);
    const placed = { ...b, lane, lanes: 1 };
    cluster.push(placed);
    out.push(placed);
  }
  close();
  return out;
}

/// Today as a day planner: the week with BS dates, the day's logged work,
/// breaks and running timers on an hour line, and what is still open today.
export function DayPlanner({
  tasks,
  projects,
  time,
  timers,
  today,
  attendance,
  onOpen,
  onCheck,
}: {
  tasks: PlannerTask[];
  projects: Project[];
  time: TimeData | null;
  timers: Timers;
  today: string;
  attendance: AttendanceDay | undefined;
  onOpen: (id: string) => void;
  onCheck: () => void;
}) {
  const { num } = useSettings();
  const [day, setDay] = useState(today);
  const week = daysFrom(weekStart(today), 7);
  const isToday = day === today;
  const now = timers.now;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const colorOf = (taskId: string) => projects.find((p) => p.id === byId.get(taskId)?.project_id)?.color;

  const from = startOfLocalDay(day);
  const to = from + 24 * 3_600_000;
  const inDay = (ms: number) => ms >= from && ms < to;

  const raw: Omit<Block, 'lane' | 'lanes'>[] = [];
  for (const s of time?.sessions ?? []) {
    if (!inDay(s.started_at_ms) || s.minutes <= 0) continue;
    raw.push({
      key: s.id,
      kind: 'work',
      taskId: s.task_id,
      title: byId.get(s.task_id)?.title ?? 'Task',
      color: colorOf(s.task_id),
      from: s.started_at_ms,
      to: s.started_at_ms + s.minutes * 60_000,
    });
  }
  for (const r of time?.runs ?? []) {
    if (!inDay(r.started_at_ms)) continue;
    const name = time?.breaks.find((b) => b.id === r.break_id)?.title;
    raw.push({ key: r.id, kind: 'break', taskId: null, title: name && name !== 'Break' ? `Break · ${name}` : 'Break', from: r.started_at_ms, to: Math.max(r.ended_at_ms, r.started_at_ms + 60_000) });
  }
  if (isToday) {
    for (const [id, t] of Object.entries(timers.state.timers)) {
      if (t.startedAt == null) continue;
      raw.push({ key: `live-${id}`, kind: 'live', taskId: id, title: byId.get(id)?.title ?? 'Task', color: colorOf(id), from: t.startedAt, to: now });
    }
    const f = timers.state.focus;
    if (f && f.phase === 'focus') {
      raw.push({ key: 'focus', kind: 'live', taskId: f.taskId, title: f.title, color: colorOf(f.taskId), from: f.startedAt, to: now, plannedTo: f.endsAt });
    }
    const rest = timers.state.rest;
    if (rest) raw.push({ key: 'rest', kind: 'break', taskId: null, title: rest.title ? `Break · ${rest.title}` : 'On a break', from: rest.startedAt, to: now });
  }
  const blocks = laneOut(raw);

  const hourOf = (ms: number) => (ms - from) / 3_600_000;
  const first = Math.max(0, Math.min(8, ...blocks.map((b) => Math.floor(hourOf(b.from))), ...(isToday ? [Math.floor(hourOf(now)) - 1] : [])));
  const last = Math.min(24, Math.max(18, ...blocks.map((b) => Math.ceil(hourOf(Math.max(b.to, b.plannedTo ?? 0)))), ...(isToday ? [Math.ceil(hourOf(now)) + 1] : [])));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const y = (ms: number) => (hourOf(ms) - first) * hourPx;

  const dayTime = time ? weekTime([day], time)[0] : undefined;
  const live = isToday ? Object.values(timers.state.timers).some((t) => t.startedAt != null) || timers.state.focus?.phase === 'focus' : false;
  const top = tasks.filter((t) => !t.parent_id);
  const doneToday = top.filter((t) => t.status === 'done' && t.completed_at_ms != null && inDay(t.completed_at_ms)).length;
  const open = top
    .filter((t) => !isClosed(t.status) && (t.status === 'doing' || t.due_date === day || (isToday && isOverdue(t, today))))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const planned = doneToday + open.length;
  const ring = 2 * Math.PI * 30;

  return (
    <div className="day-planner">
      <div className="week-strip" role="group" aria-label="Pick a day">
        {week.map((d) => {
          const date = new Date(startOfLocalDay(d));
          return (
            <button key={d} className={['week-day', d === day && 'on', d === today && 'today'].filter(Boolean).join(' ')} aria-pressed={d === day} onClick={() => setDay(d)}>
              <small>{date.toLocaleDateString('en-GB', { weekday: 'short' })}</small>
              <b>{num(String(date.getDate()))}</b>
              <small>{bsLabel(d, num, true) ?? ' '}</small>
            </button>
          );
        })}
      </div>

      <div className="day-body">
        <section className="timeline" aria-label={isToday ? "Today's timeline" : 'Timeline'} style={{ height: hours.length * hourPx + 8 }}>
          {hours.map((h) => (
            <div key={h} className="hour" style={{ top: (h - first) * hourPx }}>
              <span>{num(new Date(from + h * 3_600_000).toLocaleTimeString(undefined, { hour: 'numeric' }))}</span>
            </div>
          ))}
          {blocks.map((b) => {
            const style = {
              top: y(b.from),
              height: Math.max(26, y(b.to) - y(b.from)),
              left: `calc(64px + (100% - 72px) * ${b.lane} / ${b.lanes})`,
              width: `calc((100% - 72px) / ${b.lanes} - 6px)`,
            };
            const minutes = Math.round((b.to - b.from) / 60_000);
            const label = `${b.title}, ${clockTime(b.from, num)}${b.kind === 'live' ? ', running' : `, ${durationLabel(minutes, num)}`}`;
            const body = (
              <>
                <span className="blk-title">
                  {b.kind === 'break' ? <Leaf size={13} /> : <span className="dot" data-color={b.color} aria-hidden="true" />}
                  {b.title}
                </span>
                <span className="blk-time">
                  {clockTime(b.from, num)}
                  {b.kind === 'live' ? ` · running ${num(clockText(b.to - b.from))}` : ` · ${durationLabel(Math.max(1, minutes), num)}`}
                </span>
              </>
            );
            return (
              <div key={b.key}>
                {b.plannedTo && b.plannedTo > b.to && (
                  <div className="blk planned" style={{ ...style, top: y(b.to), height: Math.max(8, y(b.plannedTo) - y(b.to)) }} aria-hidden="true" />
                )}
                {b.taskId ? (
                  <button className={`blk ${b.kind}`} style={style} aria-label={label} onClick={() => onOpen(b.taskId!)}>
                    {body}
                  </button>
                ) : (
                  <div className={`blk ${b.kind}`} style={style} role="img" aria-label={label}>
                    {body}
                  </div>
                )}
              </div>
            );
          })}
          {isToday && (
            <div className="now-line" style={{ top: y(now) }} aria-hidden="true">
              <span>{clockTime(now, num)}</span>
            </div>
          )}
          {blocks.length === 0 && (
            <p className="timeline-empty muted">
              {isToday ? 'Nothing logged yet today. Start a timer on a task and it shows up here.' : 'Nothing logged on this day.'}
            </p>
          )}
        </section>

        <aside className="day-side" aria-label="Your day">
          <div className="panel-card day-card">
            <span className="kicker">{isToday ? 'Your day so far' : (bsLabel(day, num) ?? day)}</span>
            <div className="day-stats">
              {isToday && planned > 0 && (
                <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${doneToday} of ${planned} done today`}>
                  <circle cx="38" cy="38" r="30" className="ring-track" />
                  <circle cx="38" cy="38" r="30" className="ring-fill done" strokeDasharray={`${(ring * doneToday) / planned} ${ring}`} transform="rotate(-90 38 38)" />
                  <text x="38" y="43" textAnchor="middle" className="ring-text">
                    {num(`${doneToday}/${planned}`)}
                  </text>
                </svg>
              )}
              <div className="day-numbers">
                <span>
                  <b>{durationLabel(dayTime?.workedMinutes ?? 0, num)}</b> work logged
                </span>
                <span>
                  <b className="done-ink">{durationLabel(dayTime?.breakMinutes ?? 0, num)}</b> breaks
                </span>
                {live && <span className="acc-ink">A timer is running</span>}
              </div>
            </div>
            {isToday && (
              <div className="day-check">
                <span className="muted small">
                  {attendance?.check_out_ms
                    ? `Checked out at ${clockTime(attendance.check_out_ms, num)}`
                    : attendance?.check_in_ms
                      ? `Checked in at ${clockTime(attendance.check_in_ms, num)}`
                      : 'Not checked in yet'}
                </span>
                {!attendance?.check_out_ms && (
                  <button className="secondary small-button push" onClick={onCheck}>
                    {attendance?.check_in_ms ? 'Check out' : 'Check in'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <h2 className="side-list-head">
              <span className="kicker">{isToday ? 'Still open today' : 'Due this day'}</span>
              <span className="count">{num(open.length)}</span>
            </h2>
            {open.length === 0 ? (
              <p className="muted small">{isToday ? "You're all set for today." : 'Nothing due.'}</p>
            ) : (
              <ul className="ruled">
                {open.map((t) => {
                  const timer = timers.state.timers[t.id];
                  const running = timer?.startedAt != null;
                  const overdue = isOverdue(t, today);
                  return (
                    <li key={t.id} className="open-row">
                      <button className="open-main" onClick={() => onOpen(t.id)}>
                        <span className="open-title">{t.title}</span>
                        <span className={overdue ? 'muted small attn-ink' : 'muted small'}>
                          {overdue ? 'Overdue' : t.status === 'doing' ? 'In progress' : 'Due today'}
                          {t.estimate_minutes != null && ` · ${durationLabel(t.estimate_minutes, num)}`}
                          {timer && ` · ${num(clockText(timerElapsed(timer, now)))}`}
                        </span>
                      </button>
                      {isToday && (
                        <button
                          className={running ? 'tile-timer on' : 'tile-timer'}
                          aria-label={running ? `Pause timer: ${t.title}` : `Start timer: ${t.title}`}
                          onClick={() => timers.toggle(t)}
                        >
                          {running ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
