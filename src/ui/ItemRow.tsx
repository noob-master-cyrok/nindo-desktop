import type { Entry } from '../domain/agenda';
import type { Festival } from '../domain/calendar';
import { isCritical, isDone, kindLabel, recurrence } from '../domain/item';
import { repeats } from '../domain/recurrence';
import { useDates } from './dateText';
import { Check, DiyoIcon, Flame, Refresh } from './Icons';

/// One calendar item on one day, as a ruled row: the done circle, the time
/// (or "All day"), the name, then type, critical, repeat and overdue marks.
export function ItemRow({
  entry,
  today,
  selected,
  showDate = false,
  onOpen,
  onDone,
}: {
  entry: Entry;
  today: string;
  selected?: boolean;
  showDate?: boolean;
  onOpen: () => void;
  onDone?: () => void;
}) {
  const d = useDates();
  const { item, date, current } = entry;
  const done = isDone(item);
  const overdue = !done && current && date < today;
  return (
    <div className={['item-row', selected && 'selected', done && 'is-done'].filter(Boolean).join(' ')}>
      <button
        className={done ? 'done-circle on' : 'done-circle'}
        aria-label={done ? `${item.title} is done` : `Mark ${item.title} done`}
        title={!current ? 'A later date of this repeat' : done ? 'Done' : 'Mark done'}
        disabled={done || !current || !onDone}
        onClick={onDone}
      >
        {done && <Check size={12} />}
      </button>
      <button className="item-open" onClick={onOpen}>
        <span className="item-when">{showDate ? d.short(date) : item.due_time ? d.num(item.due_time) : 'All day'}</span>
        <span className={done ? 'item-title closed' : 'item-title'}>{item.title}</span>
        <span className="item-meta">
          {showDate && item.due_time && <span className="meta-item">{d.num(item.due_time)}</span>}
          <span className="kind-tag" data-kind={item.kind}>
            {kindLabel(item.kind)}
          </span>
          {isCritical(item) && !done && (
            <span className="crit">
              <Flame size={11} /> Critical
            </span>
          )}
          {repeats(recurrence(item)) && (
            <span className="meta-item" title="Repeats">
              <Refresh size={12} />
            </span>
          )}
          {overdue && <span className="meta-item overdue">Overdue</span>}
        </span>
      </button>
    </div>
  );
}

/// A festival or named day as a row.
export function FestivalRow({ festival, showDate, onOpen }: { festival: Festival; showDate?: boolean; onOpen: () => void }) {
  const d = useDates();
  return (
    <div className="item-row festival-row">
      <span className={festival.holiday ? 'fest-mark holiday' : 'fest-mark'} aria-hidden="true">
        <DiyoIcon size={14} />
      </span>
      <button className="item-open" onClick={onOpen}>
        <span className="item-when">{showDate ? d.short(festival.iso) : festival.holiday ? 'Holiday' : 'Festival'}</span>
        <span className={festival.holiday ? 'item-title holiday-ink' : 'item-title'}>{festival.nameEn}</span>
        <span className="item-meta">
          <span className="muted small" lang="ne">
            {festival.nameNe}
          </span>
        </span>
      </button>
    </div>
  );
}
