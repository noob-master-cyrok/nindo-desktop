import { useMemo, useState } from 'react';
import { byDay, entriesBetween } from '../domain/agenda';
import { bsFirst as bsMin, bsLast as bsMax, bsMonthLength, bsMonthNames, fromBs, toBs } from '../domain/bs';
import { lunarLabel, statusLabel, tithiName } from '../domain/calendar';
import { addDays, isoWeekday, monthLength, weekStart, ymd } from '../domain/dates';
import { isDone } from '../domain/item';
import { useDates } from './dateText';
import { ChevronSide, Plus } from './Icons';
import { FestivalRow, ItemRow } from './ItemRow';
import type { LifeProps } from './LifeScreens';
import { Segmented } from './Segmented';

export type CalView = 'year' | 'month' | 'week' | 'events';

const adMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Month {
  /// Calendar system, year and month (1–12) of the grid.
  bs: boolean;
  year: number;
  month: number;
  days: string[];
}

function monthOf(iso: string, bs: boolean): Month {
  const b = bs ? toBs(iso) : null;
  if (b) {
    const len = bsMonthLength(b.year, b.month)!;
    const first = fromBs({ year: b.year, month: b.month, day: 1 })!;
    return { bs: true, year: b.year, month: b.month, days: Array.from({ length: len }, (_, i) => addDays(first, i)) };
  }
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return { bs: false, year: y, month: m, days: Array.from({ length: monthLength(y, m) }, (_, i) => ymd(y, m, i + 1)) };
}

/// The first day of the month [delta] months from [m].
function shiftMonth(m: Month, delta: number): string {
  const index = m.year * 12 + m.month - 1 + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (m.bs) return fromBs({ year: Math.min(Math.max(year, bsMin), bsMax), month, day: 1 }) ?? m.days[0]!;
  return ymd(year, month, 1);
}

export function CalendarScreen({ life, view, onView }: { life: LifeProps; view: CalView; onView: (v: CalView) => void }) {
  const d = useDates();
  const { cal, today, items } = life;
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState<string>(today);
  const [jump, setJump] = useState(false);
  const month = monthOf(anchor, d.bsFirst);
  const range = useMemo(() => {
    if (view === 'year') {
      const first = month.bs ? fromBs({ year: month.year, month: 1, day: 1 })! : ymd(month.year, 1, 1);
      const last = month.bs ? addDays(fromBs({ year: month.year + 1, month: 1, day: 1 }) ?? ymd(month.year + 1, 4, 13), -1) : ymd(month.year, 12, 31);
      return { from: first, to: last };
    }
    if (view === 'week') {
      const s = weekStart(anchor);
      return { from: s, to: addDays(s, 6) };
    }
    return { from: month.days[0]!, to: month.days[month.days.length - 1]! };
  }, [view, anchor, month.bs, month.year, month.days]);
  const entries = useMemo(() => byDay(items ? entriesBetween(items, range.from, range.to) : []), [items, range.from, range.to]);
  const monthName = (m: Month) => (m.bs ? bsMonthNames[m.month - 1] : adMonths[m.month - 1]);
  const otherSpan = (m: Month) => {
    const a = m.days[0]!;
    const b = m.days[m.days.length - 1]!;
    if (m.bs) {
      const ma = adMonths[Number(a.slice(5, 7)) - 1]!.slice(0, 3);
      const mb = adMonths[Number(b.slice(5, 7)) - 1]!.slice(0, 3);
      return d.num(`${ma}${ma !== mb ? `–${mb}` : ''} ${b.slice(0, 4)}`);
    }
    const ba = toBs(a);
    const bb = toBs(b);
    if (!ba || !bb) return '';
    return d.num(`${bsMonthNames[ba.month - 1]}${ba.month !== bb.month ? `–${bsMonthNames[bb.month - 1]}` : ''} ${bb.year}`);
  };

  const step = (delta: number) => {
    if (view === 'week') setAnchor(addDays(anchor, delta * 7));
    else if (view === 'year') setAnchor(shiftMonth(month, delta * 12));
    else setAnchor(shiftMonth(month, delta));
  };
  const title = view === 'year' ? d.num(String(month.year)) : view === 'week' ? `${d.primary(range.from, false)} – ${d.primary(range.to)}` : `${monthName(month)} ${d.num(month.year)}`;
  const sub = view === 'year' ? (month.bs ? d.num(`${range.from.slice(0, 4)}–${range.to.slice(0, 4)}`) : '') : view === 'week' ? '' : otherSpan(month);
  const projected = month.bs && month.year > 2083;

  const red = (iso: string) => isoWeekday(iso) === 6 || !!cal?.isHoliday(iso);

  const cell = (iso: string) => {
    const b = toBs(iso);
    const t = cal?.day(iso);
    const fest = cal?.festivals(iso) ?? [];
    const own = entries.get(iso) ?? [];
    const primary = month.bs ? b?.day : Number(iso.slice(8));
    const secondary = month.bs ? Number(iso.slice(8)) : b?.day;
    return (
      <button
        key={iso}
        role="gridcell"
        className={['cal-cell', iso === today && 'today', iso === picked && 'picked', red(iso) && 'red'].filter(Boolean).join(' ')}
        aria-label={`${d.weekday(iso)}, ${d.primary(iso)}${t ? `, ${tithiName(t.tithi)}` : ''}${fest.length ? `, ${fest.map((f) => f.nameEn).join(', ')}` : ''}${own.length ? `, ${own.length} items` : ''}`}
        aria-selected={iso === picked}
        onClick={() => setPicked(iso)}
        onDoubleClick={() => life.onNewItem({ date: iso })}
      >
        <span className="cell-top">
          <span className="cell-day">{d.num(primary ?? '')}</span>
          {secondary != null && <span className="cell-sub">{d.num(secondary)}</span>}
        </span>
        {t && <span className="cell-tithi">{tithiName(t.tithi)}</span>}
        {fest.length > 0 && <span className={fest.some((f) => f.holiday) ? 'cell-fest holiday' : 'cell-fest'}>{fest[0]!.nameEn}</span>}
        {own.length > 0 && (
          <span className="cell-dots" aria-hidden="true">
            {own.slice(0, 4).map((e) => (
              <span key={e.item.id} className={isDone(e.item) ? 'dot done' : e.item.urgency >= 3 ? 'dot crit-dot' : 'dot acc'} />
            ))}
          </span>
        )}
      </button>
    );
  };

  const grid = (m: Month, mini = false) => {
    const lead = isoWeekday(m.days[0]!) % 7;
    return (
      <div className={mini ? 'cal-grid mini' : 'cal-grid'} role="grid" aria-label={`${monthName(m)} ${m.year}`}>
        {weekdays.map((w, i) => (
          <span key={w} className={i === 6 ? 'cal-wd red' : 'cal-wd'} role="columnheader">
            {mini ? w[0] : w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} className="cal-blank" />
        ))}
        {mini
          ? m.days.map((iso) => (
              <span key={iso} className={['mini-day', iso === today && 'today', red(iso) && 'red', entries.has(iso) && 'busy'].filter(Boolean).join(' ')}>
                {d.num(m.bs ? toBs(iso)!.day : Number(iso.slice(8)))}
              </span>
            ))
          : m.days.map(cell)}
      </div>
    );
  };

  const day = (iso: string) => {
    const t = cal?.day(iso);
    const fest = cal?.festivals(iso) ?? [];
    const own = entries.get(iso) ?? (items ? entriesBetween(items, iso, iso) : []);
    return (
      <section className="day-card panel-card" aria-label={`Day details, ${d.primary(iso)}`}>
        <div className="day-card-head">
          <button className="icon-button small" aria-label="Previous day" onClick={() => { setPicked(addDays(iso, -1)); setAnchor(addDays(iso, -1)); }}>
            <ChevronSide left size={16} />
          </button>
          <div className="day-card-title">
            <span className={red(iso) ? 'day-big red' : 'day-big'}>{d.num(d.bsFirst ? (toBs(iso)?.day ?? Number(iso.slice(8))) : Number(iso.slice(8)))}</span>
            <span className="stack tight">
              <span className="kicker">{iso === today ? 'Today' : d.weekday(iso)}</span>
              <span>{d.primary(iso)}</span>
              {d.secondary(iso) && <span className="muted small">{d.secondary(iso)}</span>}
            </span>
          </div>
          <button className="icon-button small" aria-label="Next day" onClick={() => { setPicked(addDays(iso, 1)); setAnchor(addDays(iso, 1)); }}>
            <ChevronSide size={16} />
          </button>
        </div>
        {t && (
          <p className="tithi-line">
            {lunarLabel(t)} <span className="muted small">· {statusLabel[t.status]}</span>
          </p>
        )}
        {fest.map((f) => (
          <FestivalRow key={f.id} festival={f} onOpen={() => life.onOpenFestival(f)} />
        ))}
        {own.map((e) => (
          <ItemRow key={`${e.item.id}-${e.date}`} entry={e} today={today} selected={life.selectedItem === e.item.id} onOpen={() => life.onOpenItem(e.item.id)} onDone={() => life.onDone(e.item)} />
        ))}
        {!own.length && !fest.length && <p className="card-empty muted">Nothing on this day.</p>}
        <button className="text add-on-day" onClick={() => life.onNewItem({ date: iso })}>
          <Plus size={14} /> Add on this day
        </button>
      </section>
    );
  };

  const yearMonths: Month[] = view === 'year' ? Array.from({ length: 12 }, (_, i) => monthOf(month.bs ? fromBs({ year: month.year, month: i + 1, day: 1 }) ?? today : ymd(month.year, i + 1, 1), month.bs)) : [];

  return (
    <>
      <div className="page-head cal-head">
        <div className="cal-title">
          <button className="cal-title-button" aria-expanded={jump} onClick={() => setJump((j) => !j)} title="Jump to a month">
            <h1 className="page-title">{title}</h1>
          </button>
          {sub && <span className="muted">{sub}</span>}
          {jump && (
            <JumpTo
              bs={month.bs}
              year={month.year}
              month={month.month}
              onPick={(iso) => {
                setAnchor(iso);
                setPicked(iso);
                setJump(false);
              }}
              onClose={() => setJump(false)}
            />
          )}
        </div>
        <div className="head-actions">
          <button className="icon-button" aria-label="Previous" title="Previous" onClick={() => step(-1)}>
            <ChevronSide left />
          </button>
          <button className="secondary" onClick={() => { setAnchor(today); setPicked(today); }}>
            Today
          </button>
          <button className="icon-button" aria-label="Next" title="Next" onClick={() => step(1)}>
            <ChevronSide />
          </button>
          <Segmented<CalView>
            label="Calendar view"
            value={view}
            options={[
              { value: 'year', label: 'Year' },
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
              { value: 'events', label: 'Events' },
            ]}
            onChange={onView}
          />
        </div>
      </div>
      {projected && <p className="muted small">BS {d.num(month.year)} uses Nepali Patro&apos;s projected month lengths; the official calendar isn&apos;t published yet.</p>}

      {view === 'year' && (
        <div className="year-grid">
          {yearMonths.map((m) => (
            <button
              key={`${m.year}-${m.month}`}
              className="year-month"
              onClick={() => {
                setAnchor(m.days[0]!);
                onView('month');
              }}
            >
              <span className="year-month-name">{monthName(m)}</span>
              {grid(m, true)}
            </button>
          ))}
        </div>
      )}

      {view === 'month' && (
        <div className="cal-month">
          {grid(month)}
          {day(picked)}
        </div>
      )}

      {view === 'week' && (
        <div className="week-grid" role="grid" aria-label="Week">
          {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((iso) => {
            const fest = cal?.festivals(iso) ?? [];
            const t = cal?.day(iso);
            return (
              <section key={iso} className={['week-day', iso === today && 'today', red(iso) && 'red'].filter(Boolean).join(' ')} aria-label={d.primary(iso)}>
                <button className="week-day-head" onClick={() => life.onNewItem({ date: iso })} title="Add on this day">
                  <span className="kicker">{d.weekday(iso).slice(0, 3)}</span>
                  <span className="week-num">{d.num(d.bsFirst ? (toBs(iso)?.day ?? Number(iso.slice(8))) : Number(iso.slice(8)))}</span>
                  <span className="muted small">{d.secondary(iso, false)}</span>
                  {t && <span className="cell-tithi">{tithiName(t.tithi)}</span>}
                </button>
                {fest.map((f) => (
                  <button key={f.id} className={f.holiday ? 'week-chip fest holiday' : 'week-chip fest'} onClick={() => life.onOpenFestival(f)}>
                    {f.nameEn}
                  </button>
                ))}
                {(entries.get(iso) ?? []).map((e) => (
                  <button key={e.item.id} className={isDone(e.item) ? 'week-chip done' : 'week-chip'} onClick={() => life.onOpenItem(e.item.id)}>
                    <span className="week-time">{e.item.due_time ? d.num(e.item.due_time) : 'All day'}</span>
                    {e.item.title}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {view === 'events' && (
        <div className="stack">
          {month.days.filter((iso) => entries.has(iso) || (cal?.festivals(iso).length ?? 0) > 0).length === 0 && <p className="empty muted">Nothing this month.</p>}
          {month.days
            .filter((iso) => entries.has(iso) || (cal?.festivals(iso).length ?? 0) > 0)
            .map((iso) => (
              <section key={iso} className="day-group" aria-label={d.primary(iso)}>
                <h3 className={red(iso) ? 'group-head red' : 'group-head'}>
                  <span className="group-name">
                    {iso === today ? 'Today · ' : ''}
                    {d.weekday(iso)}, {d.primary(iso, false)}
                  </span>
                  <span className="muted small">{d.secondary(iso, false)}</span>
                </h3>
                {(cal?.festivals(iso) ?? []).map((f) => (
                  <FestivalRow key={f.id} festival={f} onOpen={() => life.onOpenFestival(f)} />
                ))}
                {(entries.get(iso) ?? []).map((e) => (
                  <ItemRow key={`${e.item.id}-${e.date}`} entry={e} today={today} selected={life.selectedItem === e.item.id} onOpen={() => life.onOpenItem(e.item.id)} onDone={() => life.onDone(e.item)} />
                ))}
              </section>
            ))}
        </div>
      )}
      <p className="muted small foot-note">Double-click a day to add on it. Google calendars you connected on the phone show only on the phone.</p>
    </>
  );
}

function JumpTo({ bs, year, month, onPick, onClose }: { bs: boolean; year: number; month: number; onPick: (iso: string) => void; onClose: () => void }) {
  const [y, setY] = useState(year);
  const [m, setM] = useState(month);
  const iso = bs ? fromBs({ year: y, month: m, day: 1 }) : y >= 1 && y <= 9999 ? ymd(y, m, 1) : null;
  return (
    <form
      className="jump-pop"
      onSubmit={(e) => {
        e.preventDefault();
        if (iso) onPick(iso);
      }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="jump-months" role="radiogroup" aria-label="Month">
        {(bs ? bsMonthNames : adMonths).map((name, i) => (
          <button type="button" key={name} role="radio" aria-checked={m === i + 1} className={m === i + 1 ? 'chip on' : 'chip'} onClick={() => setM(i + 1)}>
            {name.slice(0, 3)}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="kicker">Year ({bs ? 'BS' : 'AD'})</span>
        <input type="number" value={y} min={bs ? bsMin : 1900} max={bs ? bsMax : 2200} autoFocus onChange={(e) => setY(Number(e.target.value))} />
      </label>
      {!iso && <p className="error small">{bs ? `BS dates here run from ${bsMin} to ${bsMax}.` : 'Pick a real year.'}</p>}
      <div className="row end">
        <button type="button" className="text" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!iso}>
          Go
        </button>
      </div>
    </form>
  );
}
