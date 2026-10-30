import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Note } from '../data/itemsRepo';
import { byDay, entriesBetween, type Entry } from '../domain/agenda';
import { lunarLabel, statusLabel, tithiName, type Festival, type NepaliCalendar } from '../domain/calendar';
import { addDays } from '../domain/dates';
import { compareItems, isCritical, isDone, type Item } from '../domain/item';
import { isClosed, isOverdue as taskOverdue, type PlannerTask } from '../domain/planner';
import { buildSearchDocs, fieldLabels, highlightRanges, search, searchPageSize, searchSnippet, type SearchDoc, type SearchHit } from '../domain/search';
import { useSettings } from '../settings';
import { useDates } from './dateText';
import { AlarmIcon, ChevronSide, Close, DiyoIcon, EventsIcon, PeopleIcon, Plus, Search as SearchIcon, TasksIcon } from './Icons';
import { FestivalRow, ItemRow } from './ItemRow';
import { Segmented } from './Segmented';

export interface LifeProps {
  items: Item[] | null;
  notes: Note[];
  cal: NepaliCalendar | null;
  today: string;
  selectedItem: string | null;
  error: string | null;
  onOpenItem: (id: string) => void;
  onNewItem: (defaults?: { date?: string; kind?: string }) => void;
  onDone: (item: Item) => void;
  onOpenFestival: (f: Festival) => void;
}

const nowHm = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

function greeting(hour: number) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/// The big date: the day number in the leading calendar, its month and
/// year, the other calendar between two rules, and the tithi under both.
export function DateHero({ iso, cal, kicker }: { iso: string; cal: NepaliCalendar | null; kicker?: string }) {
  const d = useDates();
  const { update, settings } = useSettings();
  const t = cal?.day(iso);
  const primary = d.primary(iso);
  const [day, ...rest] = primary.split(' ');
  return (
    <button
      className="date-hero"
      title={`Show ${d.bsFirst ? 'AD' : 'BS'} first`}
      aria-label={`${d.weekday(iso)}, ${primary}${d.secondary(iso) ? `, ${d.secondary(iso)}` : ''}${t ? `, ${lunarLabel(t)}` : ''}. Switch calendars.`}
      onClick={() => update({ calendarFirst: settings.calendarFirst === 'BS' ? 'AD' : 'BS' })}
    >
      <span className="hero-day" aria-hidden="true">
        {day}
      </span>
      <span className="hero-words" aria-hidden="true">
        <span className="kicker">{kicker ?? `${d.weekday(iso)} · Today`}</span>
        <span className="hero-month">{rest.join(' ')}</span>
        {d.secondary(iso) && <span className="hero-bs ruled-line">{d.secondary(iso)}</span>}
        {t && <span className="hero-tithi">{lunarLabel(t)}</span>}
      </span>
    </button>
  );
}

function Loading({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : (
    <p className="muted">Loading your calendar…</p>
  );
}

// Today -------------------------------------------------------------------

export function TodayScreen({ life, tasks, onOpenTasks, onOpenTask }: { life: LifeProps; tasks: PlannerTask[]; onOpenTasks: () => void; onOpenTask: (id: string) => void }) {
  const { settings } = useSettings();
  const d = useDates();
  const { items, cal, today } = life;
  const hm = nowHm();
  const fest = cal?.festivals(today) ?? [];
  const todays = useMemo(() => (items ? entriesBetween(items, today, today) : []), [items, today]);
  const attention = useMemo(() => {
    if (!items) return [];
    const soon = addDays(today, 7);
    return items
      .filter((i) => !isDone(i) && !i.undated && (i.due_date_ad < today || (isCritical(i) && i.due_date_ad > today && i.due_date_ad <= soon)))
      .sort(compareItems)
      .map((item): Entry => ({ item, date: item.due_date_ad, current: true }));
  }, [items, today]);
  const upcoming = useMemo(() => {
    if (!items) return [];
    const from = addDays(today, 1);
    const to = addDays(today, 30);
    // The next date of each item only, so a daily repeat shows once.
    const seen = new Set<string>();
    const own = entriesBetween(items, from, to).filter((e) => {
      if (isDone(e.item) || !['birthday', 'event', 'appointment', 'bill', 'renewal'].includes(e.item.kind) || seen.has(e.item.id)) return false;
      seen.add(e.item.id);
      return true;
    });
    const fests = (cal?.between(from, to) ?? []).filter((f) => f.holiday || f.kind === 'festival');
    return [...own.map((e): { date: string; entry?: Entry; fest?: Festival } => ({ date: e.date, entry: e })), ...fests.map((f): { date: string; entry?: Entry; fest?: Festival } => ({ date: f.iso, fest: f }))].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  }, [items, cal, today]);

  const top = tasks.filter((t) => !t.parent_id);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const doneToday = top.filter((t) => t.status === 'done' && (t.completed_at_ms ?? 0) >= dayStart.getTime()).length;
  const openToday = top.filter((t) => !isClosed(t.status) && (t.status === 'doing' || t.due_date === today || taskOverdue(t, today)));
  const total = doneToday + openToday.length;
  const critical = openToday.filter((t) => t.critical);
  const nowIndex = todays.findIndex((e) => (e.item.due_time ?? '00:00') > hm);

  return (
    <>
      <header className="hero today-hero">
        <div className="stack tight">
          <p className="greeting">
            {greeting(new Date().getHours())}
            {settings.name.trim() ? `, ${settings.name.trim()}` : ''}
          </p>
          <DateHero iso={today} cal={cal} />
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => life.onNewItem({ date: today })}>
            <Plus size={18} /> Add
          </button>
        </div>
      </header>
      {fest.length > 0 && (
        <button className={fest.some((f) => f.holiday) ? 'fest-banner holiday' : 'fest-banner'} onClick={() => life.onOpenFestival(fest[0]!)}>
          <DiyoIcon size={18} />
          <span>
            <span className="kicker">{fest.some((f) => f.holiday) ? 'Holiday today' : 'Today'}</span>
            <span className="fest-name">{fest.map((f) => f.nameEn).join(' · ')}</span>
          </span>
        </button>
      )}
      {!items ? (
        <Loading error={life.error} />
      ) : (
        <div className="today-grid">
          <div className="stack">
            {attention.length > 0 && (
              <section className="panel-card attention" aria-label="Needs attention">
                <h2 className="card-title">Needs attention</h2>
                {attention.slice(0, 6).map((e) => (
                  <ItemRow key={e.item.id} entry={e} today={today} showDate selected={life.selectedItem === e.item.id} onOpen={() => life.onOpenItem(e.item.id)} onDone={() => life.onDone(e.item)} />
                ))}
              </section>
            )}
            <section className="panel-card" aria-label="Today">
              <h2 className="card-title">Today</h2>
              {todays.length === 0 ? (
                <p className="card-empty muted">
                  Nothing on today.{' '}
                  <button className="text" onClick={() => life.onNewItem({ date: today })}>
                    Add a reminder
                  </button>
                </p>
              ) : (
                todays.map((e, i) => (
                  <div key={`${e.item.id}-${e.date}`}>
                    {i === nowIndex && <div className="today-now" aria-label={`Now, ${hm}`}><span>{d.num(hm)}</span></div>}
                    <ItemRow entry={e} today={today} selected={life.selectedItem === e.item.id} onOpen={() => life.onOpenItem(e.item.id)} onDone={() => life.onDone(e.item)} />
                  </div>
                ))
              )}
              {todays.length > 0 && nowIndex === -1 && <div className="today-now" aria-label={`Now, ${hm}`}><span>{d.num(hm)}</span></div>}
            </section>
          </div>
          <div className="stack">
            <section className="panel-card" aria-label="Tasks">
              <div className="card-head">
                <TasksIcon size={20} />
                <div className="card-titles">
                  <h2 className="card-title">Tasks</h2>
                  <span className="muted small">{total ? d.num(`${doneToday} of ${total} done today`) : 'Nothing planned for today'}</span>
                </div>
                {total > 0 && (
                  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="push">
                    <circle cx="20" cy="20" r="16" className="ring-track" strokeWidth="4" />
                    <circle cx="20" cy="20" r="16" className="ring-fill done" strokeWidth="4" strokeDasharray={`${(2 * Math.PI * 16 * doneToday) / total} 200`} transform="rotate(-90 20 20)" />
                  </svg>
                )}
              </div>
              {(critical.length ? critical : openToday).slice(0, 4).map((t) => (
                <button key={t.id} className="hl-row" onClick={() => onOpenTask(t.id)}>
                  <span className={t.critical ? 'dot crit-dot' : 'dot acc'} aria-hidden="true" />
                  <span className="hl-title">{t.title}</span>
                  {t.critical && <span className="crit">Critical</span>}
                </button>
              ))}
              <button className="secondary" onClick={onOpenTasks}>
                Open Tasks
              </button>
            </section>
            <section className="panel-card" aria-label="Upcoming">
              <h2 className="card-title">Upcoming</h2>
              {upcoming.length === 0 && <p className="card-empty muted">No birthdays, events or festivals in the next 30 days.</p>}
              {upcoming.map((u) =>
                u.fest ? (
                  <FestivalRow key={`f-${u.fest.id}`} festival={u.fest} showDate onOpen={() => life.onOpenFestival(u.fest!)} />
                ) : (
                  <ItemRow key={`${u.entry!.item.id}-${u.date}`} entry={u.entry!} today={today} showDate onOpen={() => life.onOpenItem(u.entry!.item.id)} />
                ),
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

// Events list ---------------------------------------------------------------

type Smart = 'today' | 'upcoming' | 'overdue' | 'inbox';

export function EventsScreen({ life }: { life: LifeProps }) {
  const d = useDates();
  const { items, today } = life;
  const [tile, setTile] = useState<Smart>('upcoming');
  const [showDone, setShowDone] = useState(false);
  const all = items ?? [];
  const hm = nowHm();
  const open = all.filter((i) => !isDone(i));
  const lists: Record<Smart, Item[]> = {
    today: open.filter((i) => !i.undated && i.due_date_ad === today),
    upcoming: open.filter((i) => !i.undated && i.due_date_ad >= today),
    overdue: open.filter((i) => !i.undated && (i.due_date_ad < today || (i.due_date_ad === today && !!i.due_time && i.due_time < hm))),
    inbox: open.filter((i) => i.undated),
  };
  const shown = [...lists[tile]].sort(compareItems);
  const groups = tile === 'upcoming' ? byDay(shown.map((item) => ({ item, date: item.due_date_ad, current: true }))) : null;
  const done = all.filter(isDone).sort((a, b) => (b.completed_at_ms ?? 0) - (a.completed_at_ms ?? 0)).slice(0, 100);
  const tiles: { id: Smart; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'inbox', label: 'Inbox' },
  ];
  const row = (item: Item) => (
    <ItemRow key={item.id} entry={{ item, date: item.due_date_ad, current: true }} today={today} showDate={!item.undated} selected={life.selectedItem === item.id} onOpen={() => life.onOpenItem(item.id)} onDone={() => life.onDone(item)} />
  );

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Events</h1>
        <div className="head-actions">
          <button className="primary" onClick={() => life.onNewItem(tile === 'inbox' ? {} : { date: today })}>
            <Plus size={18} /> Add
          </button>
        </div>
      </div>
      <div className="smart-tiles" role="tablist" aria-label="Lists">
        {tiles.map((t) => (
          <button key={t.id} role="tab" aria-selected={tile === t.id} className={tile === t.id ? `smart-tile on ${t.id}` : `smart-tile ${t.id}`} onClick={() => setTile(t.id)}>
            <span className="smart-count">{d.num(lists[t.id].length)}</span>
            <span className="smart-label">{t.label}</span>
          </button>
        ))}
      </div>
      {!items ? (
        <Loading error={life.error} />
      ) : shown.length === 0 ? (
        <p className="empty muted">{tile === 'inbox' ? 'No undated items. Items without a date land here.' : tile === 'overdue' ? 'Nothing overdue. Nice.' : 'Nothing here yet.'}</p>
      ) : groups ? (
        [...groups].map(([date, entries]) => (
          <section key={date} className="day-group" aria-label={d.primary(date)}>
            <h3 className="group-head">
              <span className="group-name">{date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : `${d.weekday(date)}, ${d.primary(date, false)}`}</span>
              <span className="muted small">{d.secondary(date, false)}</span>
            </h3>
            {entries.map((e) => (
              <ItemRow key={e.item.id} entry={e} today={today} selected={life.selectedItem === e.item.id} onOpen={() => life.onOpenItem(e.item.id)} onDone={() => life.onDone(e.item)} />
            ))}
          </section>
        ))
      ) : (
        <div className="ruled-list">{shown.map(row)}</div>
      )}
      <button className="section-toggle" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
        <span>Completed</span> <span className="count">{d.num(all.filter(isDone).length)}</span>
      </button>
      {showDone && <div className="ruled-list">{done.map(row)}</div>}
    </>
  );
}

// Festivals -------------------------------------------------------------------

export function FestivalsScreen({ life }: { life: LifeProps }) {
  const d = useDates();
  const { cal, today } = life;
  const [only, setOnly] = useState<'all' | 'holidays' | 'festivals'>('all');
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    if (!cal) return [];
    const base = query.trim() ? cal.search(query).filter((f) => f.iso >= addDays(today, -30)) : cal.between(today, addDays(today, 365));
    return base.filter((f) => (only === 'holidays' ? f.holiday : only === 'festivals' ? f.kind === 'festival' || f.kind === 'kmc' : true));
  }, [cal, today, only, query]);
  const months = new Map<string, Festival[]>();
  for (const f of list) {
    const key = d.bsFirst ? (d.bs(f.iso)?.split(' ').slice(1).join(' ') ?? f.iso.slice(0, 7)) : d.ad(f.iso).split(' ').slice(1).join(' ');
    months.set(key, [...(months.get(key) ?? []), f]);
  }
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Festivals</h1>
        <div className="head-actions">
          <Segmented
            label="Show"
            value={only}
            options={[
              { value: 'all', label: 'All' },
              { value: 'holidays', label: 'Holidays' },
              { value: 'festivals', label: 'Festivals' },
            ]}
            onChange={setOnly}
          />
        </div>
      </div>
      <label className="field-pill search-pill">
        <SearchIcon size={16} />
        <input type="search" placeholder="Find a festival (English or नेपाली)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a festival" />
      </label>
      {!cal ? (
        <p className="muted">Loading festivals…</p>
      ) : list.length === 0 ? (
        <p className="empty muted">No festivals match.</p>
      ) : (
        [...months].map(([month, fests]) => (
          <section key={month} className="day-group" aria-label={month}>
            <h3 className="group-head">
              <span className="group-name">{month}</span>
            </h3>
            {fests.map((f) => (
              <FestivalRow key={`${f.id}-${f.iso}`} festival={f} showDate onOpen={() => life.onOpenFestival(f)} />
            ))}
          </section>
        ))
      )}
      <p className="muted small foot-note">
        Named days follow the phone&apos;s tithi reckoning (printed by the patros for BS 2072–2083, Nepali Patro&apos;s projection to 2093, calculated after). Holidays come from the Kathmandu
        Metropolitan City calendar for BS 2083 and are provisional until reviewed.
      </p>
    </>
  );
}

/// A festival's own page: both names, both dates, tithi, source and notes.
export function FestivalPanel({
  festival,
  cal,
  notes,
  onClose,
  onRemind,
  onAddNote,
}: {
  festival: Festival;
  cal: NepaliCalendar | null;
  notes: Note[];
  onClose: () => void;
  onRemind: () => void;
  onAddNote: (body: string) => Promise<boolean>;
}) {
  const d = useDates();
  const [note, setNote] = useState('');
  const t = cal?.day(festival.iso);
  const mine = festival.noteId ? notes.filter((n) => n.parent_type === 'festival' && n.parent_id === festival.noteId && n.deleted_at_ms == null) : [];
  return (
    <section className="editor" aria-label="Festival">
      <header className="editor-head">
        <div>
          <span className={festival.holiday ? 'kicker holiday-ink' : 'kicker acc-ink'}>{festival.holiday ? 'Public holiday' : festival.kind === 'kmc' ? 'Day of note' : 'Festival'}</span>
          <h2 className="sheet-title">{festival.nameEn}</h2>
          <p className="fest-ne" lang="ne">
            {festival.nameNe}
          </p>
        </div>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Close />
        </button>
      </header>
      <dl className="facts">
        <dt>Date</dt>
        <dd>
          {d.weekday(festival.iso)}, {d.primary(festival.iso)}
          {d.secondary(festival.iso) && <span className="muted"> · {d.secondary(festival.iso)}</span>}
        </dd>
        {t && (
          <>
            <dt>Tithi</dt>
            <dd>
              {lunarLabel(t)} <span className="muted small">({tithiName(t.tithi, 'ne')}, {statusLabel[t.status]})</span>
            </dd>
          </>
        )}
        <dt>Source</dt>
        <dd className="muted small">{festival.source === 'kmc' ? 'Kathmandu Metropolitan City calendar, BS 2083 (provisional)' : "Nindo's named days, from the tithi"}</dd>
      </dl>
      <div className="row">
        <button className="primary" onClick={onRemind}>
          <Plus size={16} /> Remind me
        </button>
      </div>
      {festival.noteId ? (
      <section className="sub" aria-label="Notes">
        <h3 className="kicker">Notes</h3>
        <ul className="activity">
          {mine.map((n) => (
            <li key={n.id} className="comment">
              <p className="note-body">{n.body}</p>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onAddNote(note)) setNote('');
          }}
        >
          <textarea aria-label="New note" rows={2} placeholder="Add a note for this day" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button className="secondary" disabled={!note.trim()}>
              Add note
            </button>
          </div>
        </form>
      </section>
      ) : (
        <p className="muted small">Notes go on days from the city calendar, the same ones the phone shows notes for.</p>
      )}
    </section>
  );
}

// Search ----------------------------------------------------------------------

export function SearchScreen({ life, tasks, onOpenTask, focusKey, query, onQuery }: { life: LifeProps; tasks: PlannerTask[]; onOpenTask: (id: string) => void; focusKey: number; query: string; onQuery: (q: string) => void }) {
  const d = useDates();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  const docs = useMemo(
    () => buildSearchDocs({ items: life.items ?? [], notes: life.notes, tasks, festivals: life.cal?.all() ?? [] }),
    [life.items, life.notes, tasks, life.cal],
  );
  const results = useMemo(() => search(docs, query, life.today), [docs, query, life.today]);

  const open = (doc: SearchDoc) => {
    if (doc.kind === 'task') onOpenTask(doc.id);
    else if (doc.kind === 'festival') life.onOpenFestival(doc.festival!);
    else life.onOpenItem(doc.id);
  };
  /// Up and down move through the results; up from the first goes back to the field.
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('.search-hit') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(at + 1, rows.length - 1)) : at - 1;
    e.preventDefault();
    if (next < 0) input.current?.focus();
    else rows[next]?.focus();
  };

  // "Bill · 16 Kartik · 09:30 · Done", "Holiday · 3 Kartik", "In progress · 2 Nov".
  const meta = (doc: SearchDoc) =>
    [doc.label, doc.kind === 'item' && !doc.day ? 'No date' : doc.day && d.short(doc.day), doc.time && d.num(doc.time), doc.kind === 'item' && doc.done && 'Done']
      .filter(Boolean)
      .join(' · ');

  const group = (title: string, hits: SearchHit[]) => (
    <section className="search-group" aria-label={title}>
      <h3 className="group-head">
        <span className="group-name">{title}</span>
        <span className="count">{d.num(hits.length)}</span>
      </h3>
      {hits.slice(0, searchPageSize).map((h) => {
        const snippet = h.detail && searchSnippet(h.detail.text, results.terms);
        const label = h.detail && fieldLabels[h.detail.kind];
        return (
          <button
            key={`${h.doc.kind}-${h.doc.id}`}
            className={life.selectedItem === h.doc.id ? 'search-hit selected' : 'search-hit'}
            aria-label={[h.doc.title, meta(h.doc), snippet && `${label}: ${snippet}`].filter(Boolean).join(', ')}
            onClick={() => open(h.doc)}
          >
            <span className="search-badge" aria-hidden="true">
              {h.doc.kind === 'task' ? <TasksIcon size={17} /> : h.doc.kind === 'festival' ? <DiyoIcon size={17} /> : <EventsIcon size={17} />}
            </span>
            <span className="search-words" aria-hidden="true">
              <Highlighted className={h.doc.done ? 'item-title closed' : 'item-title'} text={h.doc.title.replace(/\s+/g, ' ')} terms={results.terms} />
              <span className="muted small search-meta">{meta(h.doc)}</span>
              {snippet && <Highlighted className="search-snippet" text={`${label}: ${snippet}`} terms={results.terms} skip={label!.length + 2} />}
            </span>
            <ChevronSide size={14} />
          </button>
        );
      })}
      {hits.length > searchPageSize && <p className="muted small">{d.num(hits.length - searchPageSize)} more. Add a word to narrow it down.</p>}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Search</h1>
        <span className="muted small kbd-hint">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'} from anywhere</span>
      </div>
      <label className="field-pill search-pill big">
        <SearchIcon size={18} />
        <input
          ref={input}
          type="search"
          placeholder="Search reminders, events, tasks, festivals"
          value={query}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') onListKey(e);
            else if (e.key === 'Enter') {
              const first = results.full[0] ?? results.partial[0];
              if (first) open(first.doc);
            }
          }}
          aria-label="Search"
        />
      </label>
      {results.terms.length === 0 ? (
        <p className="muted search-hint">
          Finds words in titles, descriptions, steps, notes, categories, task labels and sub-tasks, and festivals in English or Nepali. People, alarms and Google events
          are searched on your phone.
        </p>
      ) : !results.full.length && !results.partial.length ? (
        <p className="empty muted">Nothing matches “{query.trim()}”</p>
      ) : (
        <div className="search-results" ref={list} onKeyDown={onListKey}>
          {results.full.length > 0 && group('Matches', results.full)}
          {results.partial.length > 0 && group('Partial matches', results.partial)}
        </div>
      )}
    </>
  );
}

/// [text] with every occurrence of [terms] bold in the accent colour; the
/// first [skip] characters (a label) are never highlighted.
function Highlighted({ text, terms, className, skip = 0 }: { text: string; terms: string[]; className?: string; skip?: number }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of highlightRanges(text, terms)) {
    const from = Math.max(start, skip);
    if (end <= from) continue;
    if (from > at) parts.push(text.slice(at, from));
    parts.push(<mark key={from}>{text.slice(from, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <span className={className}>{parts}</span>;
}

// Phone-only ------------------------------------------------------------------

export function PeopleScreen() {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">People</h1>
      </div>
      <section className="panel-card phone-only">
        <div className="card-head">
          <PeopleIcon size={22} />
          <div className="card-titles">
            <h2 className="card-title">On your phone</h2>
            <p className="muted">
              People come from your phone&apos;s contacts, with their numbers, birthdays and photos. Nindo keeps them only on the phone and never uploads them, so they
              don&apos;t appear here. Birthdays you saved as reminders are on Today, Calendar and Events.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

const presets = [1, 3, 5, 10, 15, 25, 45, 60];

/// The phone's alarms ring through the phone's own alarm system and never
/// sync. The desktop keeps a simple countdown that rings while Nindo is
/// open on this computer.
export function AlarmsScreen() {
  const d = useDates();
  const [minutes, setMinutes] = useState(5);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [ringing, setRinging] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (endsAt == null) return;
    const tick = () => {
      const ms = endsAt - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) {
        setEndsAt(null);
        setRinging(true);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  useEffect(() => {
    if (!ringing) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Timer done', { body: `${minutes} minute timer`, tag: 'nindo-timer' });
    // A soft three-note chime every two seconds, for at most a minute.
    let ctx: AudioContext | null = null;
    try {
      ctx = audio.current ?? new AudioContext();
      audio.current = ctx;
    } catch {
      ctx = null;
    }
    const chime = () => {
      if (!ctx) return;
      [660, 880, 990].forEach((f, i) => {
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx!.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.2, ctx!.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + i * 0.18 + 0.5);
        o.connect(g).connect(ctx!.destination);
        o.start(ctx!.currentTime + i * 0.18);
        o.stop(ctx!.currentTime + i * 0.18 + 0.55);
      });
    };
    chime();
    const id = setInterval(chime, 2000);
    const stop = setTimeout(() => setRinging(false), 60_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [ringing, minutes]);

  const start = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    } catch {
      // No sound on this computer; the page still shows the end.
    }
    setRinging(false);
    setEndsAt(Date.now() + minutes * 60_000);
  };
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Alarms &amp; timer</h1>
      </div>
      <section className="panel-card phone-only">
        <div className="card-head">
          <AlarmIcon size={22} />
          <div className="card-titles">
            <h2 className="card-title">Alarms ring on your phone</h2>
            <p className="muted">
              Alarms use your phone&apos;s alarm system so they ring with the app closed, in silent mode and over the lock screen. They stay on the phone and never sync, so
              they don&apos;t show here. Reminder alerts ring on the phone too.
            </p>
          </div>
        </div>
      </section>
      <section className={ringing ? 'panel-card desk-timer ringing' : 'panel-card desk-timer'} aria-label="Timer">
        <h2 className="card-title">Timer on this computer</h2>
        <p className="timer-face" role="timer" aria-live="off">
          {ringing ? 'Time’s up' : endsAt ? d.num(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`) : d.num(`${String(minutes).padStart(2, '0')}:00`)}
        </p>
        {!endsAt && !ringing && (
          <div className="chips" role="group" aria-label="Length">
            {presets.map((m) => (
              <button key={m} className={m === minutes ? 'chip on' : 'chip'} aria-pressed={m === minutes} onClick={() => setMinutes(m)}>
                {d.num(m)} min
              </button>
            ))}
            <label className="chip chip-field">
              <input type="number" min={1} max={600} value={minutes} aria-label="Minutes" onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))} /> min
            </label>
          </div>
        )}
        <div className="row">
          {ringing ? (
            <button className="primary" onClick={() => setRinging(false)}>
              Stop
            </button>
          ) : endsAt ? (
            <button className="secondary" onClick={() => setEndsAt(null)}>
              Cancel
            </button>
          ) : (
            <button className="primary" onClick={start}>
              Start
            </button>
          )}
        </div>
        <p className="muted small">Rings while Nindo is open on this computer. For an alarm that rings anywhere, use the phone.</p>
      </section>
    </>
  );
}

