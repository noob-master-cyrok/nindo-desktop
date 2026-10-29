import { useState } from 'react';
import { durationLabel } from '../domain/planner';
import { atTime, daysFrom, startOfLocalDay, timeInput, weekStart, weekTime, type AttendanceDay, type DayTime, type TimeData } from '../domain/time';
import { useSettings } from '../settings';
import { clock } from './Cards';
import { Checklist, Timer } from './Icons';
import { Modal } from './Modal';

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(iso: string): string {
  return dayNames[new Date(startOfLocalDay(iso)).getDay()]!;
}

/// Bars for one measure across the week, each day's value under its name.
function Bars({ label, days, value, tone }: { label: string; days: DayTime[]; value: (d: DayTime) => number | null; tone: string }) {
  const { num } = useSettings();
  const max = Math.max(60, ...days.map((d) => value(d) ?? 0));
  return (
    <div className="bars" role="img" aria-label={`${label}: ${days.map((d) => `${dayLabel(d.day)} ${durationLabel(value(d) ?? 0)}`).join(', ')}`}>
      <p className="kicker">{label}</p>
      <div className="bar-row">
        {days.map((d) => {
          const v = value(d);
          return (
            <div key={d.day} className="bar-col">
              <div className="bar-track">
                <span className={`bar-fill ${tone}`} style={{ height: `${v ? Math.max(4, (v / max) * 100) : 0}%` }} />
              </div>
              <span className="bar-value small muted">{v ? num(Math.round((v / 60) * 10) / 10) : '·'}</span>
              <span className="bar-day small">{dayLabel(d.day)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/// How the week is going: hours worked, break time and attendance, as on
/// the phone. Hidden until the phone has uploaded any.
export function WeekInsights({ data, today }: { data: TimeData; today: string }) {
  const { num } = useSettings();
  const days = weekTime(daysFrom(weekStart(today), 7), data);
  const total = days.reduce((n, d) => n + d.workedMinutes, 0);
  const rest = days.reduce((n, d) => n + d.breakMinutes, 0);
  const present = days.reduce((n, d) => n + (d.attendanceMinutes ?? 0), 0);
  if (!total && !rest && !present) return null;
  return (
    <section className="panel-card" aria-label="This week">
      <header className="card-head">
        <Timer size={20} className="acc-ink" />
        <div className="card-titles">
          <h2 className="card-title">This week</h2>
          <p className="muted small">
            {durationLabel(total, num)} worked · {durationLabel(rest, num)} on breaks
            {present ? ` · ${durationLabel(present, num)} at work` : ''}
          </p>
        </div>
      </header>
      <Bars label="Worked (hours)" days={days} value={(d) => d.workedMinutes} tone="acc" />
      <Bars label="Breaks (hours)" days={days} value={(d) => d.breakMinutes} tone="done" />
      <Bars label="At work (hours)" days={days} value={(d) => d.attendanceMinutes} tone="ink" />
    </section>
  );
}

/// Today's check-in and check-out, with a sheet to set any day by hand.
export function AttendanceCard({
  data,
  today,
  onSave,
  onCheck,
}: {
  data: TimeData;
  today: string;
  onSave: (day: string, values: { check_in_ms: number | null; check_out_ms: number | null; note: string }) => Promise<string | null>;
  onCheck: () => void;
}) {
  const { num } = useSettings();
  const [editing, setEditing] = useState<string | null>(null);
  const day = data.attendance.find((a) => a.id === today);
  const recent = [...data.attendance].sort((a, b) => b.id.localeCompare(a.id));

  const status = day?.check_in_ms
    ? day.check_out_ms
      ? `Out ${clock(day.check_out_ms, num)} · ${durationLabel(Math.round((day.check_out_ms - day.check_in_ms) / 60_000), num)}`
      : `In ${clock(day.check_in_ms, num)}`
    : 'Not checked in yet';

  return (
    <section className="panel-card" aria-label="Attendance">
      <header className="card-head">
        <Checklist size={20} className="acc-ink" />
        <div className="card-titles">
          <h2 className="card-title">Attendance</h2>
          <p className="muted small">{status}</p>
        </div>
        <div className="row push">
          {!day?.check_out_ms && (
            <button className={day?.check_in_ms ? 'secondary' : 'primary'} onClick={onCheck}>
              {day?.check_in_ms ? 'Check out' : 'Check in'}
            </button>
          )}
          <button className="text" onClick={() => setEditing(today)}>
            Edit today
          </button>
        </div>
      </header>
      <ul className="ruled">
        {recent.slice(0, 5).map((a) => (
          <li key={a.id}>
            <button className="hl-row" onClick={() => setEditing(a.id)}>
              <span className="hl-title">{num(a.id)}</span>
              <span className="muted small hl-when">
                {a.check_in_ms ? clock(a.check_in_ms, num) : '–'} → {a.check_out_ms ? clock(a.check_out_ms, num) : '–'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <AttendanceSheet
          day={editing}
          current={data.attendance.find((a) => a.id === editing)}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const problem = await onSave(editing, values);
            if (!problem) setEditing(null);
            return problem;
          }}
        />
      )}
    </section>
  );
}

function AttendanceSheet({
  day,
  current,
  onSave,
  onClose,
}: {
  day: string;
  current: AttendanceDay | undefined;
  onSave: (values: { check_in_ms: number | null; check_out_ms: number | null; note: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [inAt, setInAt] = useState(timeInput(current?.check_in_ms ?? null));
  const [outAt, setOutAt] = useState(timeInput(current?.check_out_ms ?? null));
  const [note, setNote] = useState(current?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Modal title={`Attendance · ${day}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const checkIn = atTime(day, inAt);
          // A check-out earlier than the check-in means the next morning.
          const checkOut = atTime(day, outAt, checkIn);
          setProblem(await onSave({ check_in_ms: checkIn, check_out_ms: checkOut, note: note.trim() }));
        }}
      >
        <div className="grid2">
          <label className="field">
            <span>Check in</span>
            <input type="time" value={inAt} onChange={(e) => setInAt(e.target.value)} />
          </label>
          <label className="field">
            <span>Check out</span>
            <input type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

/// Today's breaks: each with the time it ran.
export function BreaksCard({ data, today }: { data: TimeData; today: string }) {
  const { num } = useSettings();
  const from = startOfLocalDay(today);
  const to = from + 24 * 3_600_000;
  const runs = data.runs.filter((r) => r.started_at_ms >= from && r.started_at_ms < to);
  if (!runs.length) return null;
  const titleOf = (id: string) => data.breaks.find((b) => b.id === id)?.title || 'Break';
  const total = runs.reduce((n, r) => n + (r.ended_at_ms - r.started_at_ms) / 60_000, 0);
  return (
    <section className="panel-card" aria-label="Breaks">
      <header className="card-head">
        <Timer size={20} className="acc-ink" />
        <div className="card-titles">
          <h2 className="card-title">Breaks</h2>
          <p className="muted small">
            {num(runs.length)} today · {durationLabel(Math.round(total), num)}
          </p>
        </div>
      </header>
      <ul className="ruled">
        {runs
          .sort((a, b) => b.started_at_ms - a.started_at_ms)
          .map((r) => (
            <li key={r.id}>
              <div className="hl-row">
                <span className="hl-title">{titleOf(r.break_id)}</span>
                <span className="muted small hl-when">
                  {clock(r.started_at_ms, num)} · {durationLabel(Math.round((r.ended_at_ms - r.started_at_ms) / 60_000), num)}
                </span>
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}
