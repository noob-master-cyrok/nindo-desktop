import { useMemo, useState, type FormEvent } from 'react';
import type { CompleteOutcome, ItemsRepo, Note } from '../data/itemsRepo';
import type { SaveResult } from '../data/plannerRepo';
import { addDays, todayIso } from '../domain/dates';
import {
  alertChoices,
  alertLabel,
  builtInCategories,
  decodeOffsets,
  encodeOffsets,
  isDone,
  kindLabel,
  kinds,
  recurrence,
  urgencyLabels,
  type Item,
  type ItemEdit,
  type Step,
} from '../domain/item';
import { anchoredAt, desktopCanRepeat, nextAfter, recurrenceColumns, repeatSummary, type RepeatRule } from '../domain/recurrence';
import { useDates } from './dateText';
import { Check, Close, Copy, SkipIcon, Trash } from './Icons';
import { Picker } from './Picker';

type EditableRule = Exclude<RepeatRule, 'tithi' | 'yearTithi'>;

interface Form {
  title: string;
  kind: string;
  undated: boolean;
  date: string;
  time: string;
  rule: EditableRule;
  interval: number;
  weekdays: number[];
  end: 'never' | 'until' | 'count';
  until: string;
  count: number;
  alerts: number[];
  category: string;
  urgency: number;
  notes: string;
  steps: Step[];
}

const ruleOptions: { value: EditableRule; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthAd', label: 'Monthly (AD)' },
  { value: 'yearAd', label: 'Yearly (AD)' },
  { value: 'monthBs', label: 'Monthly (BS)' },
  { value: 'yearBs', label: 'Yearly (BS)' },
];
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formOf(item: Item | null, defaults: { date?: string; kind?: string }): Form {
  const r = item ? recurrence(item) : null;
  const editable = r && desktopCanRepeat(r) ? (r.rule as EditableRule) : 'none';
  return {
    title: item?.title ?? '',
    kind: item?.kind ?? defaults.kind ?? 'reminder',
    undated: item?.undated ?? false,
    date: item?.due_date_ad ?? defaults.date ?? todayIso(),
    time: item?.due_time ?? '',
    rule: editable,
    interval: r?.interval ?? 1,
    weekdays: r?.weekdays ?? [],
    end: r?.until ? 'until' : r?.count ? 'count' : 'never',
    until: r?.until ?? '',
    count: r?.count ?? 10,
    alerts: item ? decodeOffsets(item.alert_offsets) : [0],
    category: item?.category ?? '',
    urgency: item?.urgency ?? 1,
    notes: item?.notes ?? '',
    steps: item?.steps ?? [],
  };
}

/// The phone's item editor and item screen in one pane: details, repeat,
/// alerts, steps and the notes log, with Done, Skip, Snooze, Duplicate and
/// Delete.
export function ItemPanel({
  item,
  defaults = {},
  repo,
  notes,
  onSaved,
  onCompleted,
  onDelete,
  onDuplicated,
  onNotes,
  onClose,
  say,
}: {
  item: Item | null;
  defaults?: { date?: string; kind?: string };
  repo: ItemsRepo;
  notes: Note[];
  onSaved: (row: Item) => void;
  onCompleted: (outcome: CompleteOutcome, item: Item) => void;
  onDelete: (item: Item) => void;
  onDuplicated: (row: Item) => void;
  onNotes: () => void;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const d = useDates();
  const initial = useMemo(() => formOf(item, defaults), [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [newStep, setNewStep] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const today = todayIso();
  const r = item ? recurrence(item) : null;
  const lunar = r != null && !desktopCanRepeat(r);
  const repeating = r != null && r.rule !== 'none';
  const myNotes = item ? notes.filter((n) => n.parent_id === item.id && n.deleted_at_ms == null).sort((a, b) => a.created_at_ms - b.created_at_ms) : [];

  const next3 = useMemo(() => {
    if (!item || !r || r.rule === 'none' || !desktopCanRepeat(r)) return [];
    const out: string[] = [];
    let cursor = item.due_date_ad;
    while (out.length < 3) {
      const o = nextAfter(r, cursor);
      if (!o) break;
      out.push(o.day);
      cursor = o.day;
    }
    return out;
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  function settle(result: SaveResult<Item>): Item | null {
    if (result.status === 'saved') return result.row;
    if (result.status === 'invalid') setProblems(result.problems);
    else if (result.status === 'conflict') {
      say(`“${result.current.title}” changed on your phone. It now shows the latest version.`);
      onSaved(result.current);
    } else say('That item was deleted on another device.');
    return null;
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setProblems([]);
    try {
      return await action();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function changes(): ItemEdit {
    const out: ItemEdit = {
      title: form.title,
      kind: form.kind,
      undated: form.undated,
      due_date_ad: form.date,
      due_time: form.undated || !form.time ? null : form.time,
      alert_offsets: encodeOffsets(form.alerts),
      category: form.category.trim() || null,
      urgency: form.urgency,
      notes: form.notes.trim() || null,
      steps: form.steps,
    };
    const repeatChanged =
      !item ||
      form.date !== initial.date ||
      form.undated !== initial.undated ||
      (['rule', 'interval', 'weekdays', 'end', 'until', 'count'] as const).some((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k]));
    // A lunar repeat is the phone's to change; its columns stay as they are.
    if (repeatChanged && !lunar) {
      const rule = form.undated ? 'none' : form.rule;
      const next = anchoredAt(rule, form.date, {
        interval: form.interval,
        weekdays: form.weekdays,
        until: form.end === 'until' && form.until ? form.until : null,
        count: form.end === 'count' ? form.count : null,
      });
      if (!next) {
        setProblems(['BS repeats work only for dates inside the BS table (BS 2000–2100).']);
        return {};
      }
      Object.assign(out, recurrenceColumns(next));
    }
    return out;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const c = changes();
    if (!Object.keys(c).length) return;
    const result = await run(() => (item ? repo.update(item, c) : repo.create({ ...c, title: form.title, due_date_ad: form.date })));
    const row = result && settle(result);
    if (row) {
      say(item ? 'Saved.' : `${kindLabel(row.kind)} added.`);
      onSaved(row);
    }
  }

  async function complete(whole = false) {
    if (!item) return;
    const outcome = await run(() => repo.complete(item, today, whole));
    if (outcome && settle(outcome.result)) onCompleted(outcome, item);
  }

  async function snooze(date: string, time: string | null) {
    if (!item) return;
    setSnoozeOpen(false);
    const result = await run(() => repo.snooze(item, date, time));
    const row = result && settle(result);
    if (row) {
      say(`Snoozed to ${d.primary(date, false)}${time ? ` at ${d.num(time)}` : ''}.`);
      onSaved(row);
    }
  }

  const hm = (minutesFromNow: number) => {
    const t = new Date(Date.now() + minutesFromNow * 60_000);
    return { date: todayIso(t), time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
  };

  return (
    <section className="editor" aria-label={item ? 'Item details' : 'New item'}>
      <header className="editor-head">
        <div>
          <span className="kicker acc-ink">{kindLabel(form.kind)}</span>
          <h2 className="sheet-title">{item ? (isDone(item) ? 'Done' : form.undated ? 'Inbox' : d.primary(item.due_date_ad)) : 'New item'}</h2>
          {item && !item.undated && <p className="muted small">{[d.secondary(item.due_date_ad), item.due_time && d.num(item.due_time)].filter(Boolean).join(' · ')}</p>}
        </div>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Close />
        </button>
      </header>

      {item && (
        <div className="item-actions">
          {isDone(item) ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const row = settle(await repo.reopen(item));
                  if (row) onSaved(row);
                })
              }
            >
              Reopen
            </button>
          ) : (
            <>
              <button className="primary done-fill" disabled={busy || lunar} title={lunar ? 'Lunar repeats move on from your phone' : undefined} onClick={() => complete()}>
                <Check size={16} /> {repeating ? 'Done this time' : 'Mark complete'}
              </button>
              {repeating && !lunar && (
                <button className="secondary" disabled={busy} onClick={() => run(async () => {
                  const result = await repo.skip(item, today);
                  const row = result && settle(result);
                  if (row) {
                    say(`Skipped. Next: ${d.primary(row.due_date_ad, false)}.`);
                    onSaved(row);
                  }
                })}>
                  <SkipIcon size={14} /> Skip this time
                </button>
              )}
              <div className="menu-anchor">
                <button className="secondary" disabled={busy} aria-expanded={snoozeOpen} onClick={() => setSnoozeOpen((o) => !o)}>
                  Snooze
                </button>
                {snoozeOpen && (
                  <ul className="picker-menu snooze-menu" role="menu">
                    {[
                      { label: '10 minutes', ...hm(10) },
                      { label: '1 hour', ...hm(60) },
                      { label: 'This evening', date: today, time: '18:00' },
                      { label: 'Tomorrow morning', date: addDays(today, 1), time: '09:00' },
                      { label: 'Next week', date: addDays(today, 7), time: item.due_time },
                    ].map((o) => (
                      <li key={o.label}>
                        <button role="menuitem" className="picker-option" onClick={() => snooze(o.date, o.time)}>
                          {o.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <button className="icon-button" aria-label="Duplicate" title="Duplicate" disabled={busy} onClick={() => run(async () => {
            const row = settle(await repo.duplicate(item));
            if (row) onDuplicated(row);
          })}>
            <Copy />
          </button>
          <button className="icon-button danger-icon" aria-label="Delete" title="Delete" disabled={busy} onClick={() => onDelete(item)}>
            <Trash />
          </button>
        </div>
      )}
      {item && repeating && !isDone(item) && (
        <p className="muted small repeat-line">
          {lunar ? `${repeatSummary(r!)}. Its next dates follow the phone's sunrise tithi, so Done and Skip work from your phone.` : `${repeatSummary(r!)}.${next3.length ? ` Next: ${next3.map((x) => d.primary(x, false)).join(', ')}.` : ''}`}
          {!lunar && repeating && <> <button className="text small" disabled={busy} onClick={() => complete(true)}>Complete for good</button></>}
        </p>
      )}

      <form onSubmit={save} className="stack">
        <fieldset disabled={busy} className="stack">
          <label className="field">
            <span className="kicker">Name</span>
            <input className="title-input" value={form.title} maxLength={200} required autoFocus={!item} placeholder={form.kind === 'task' ? 'Task name' : 'What to remember'} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <div className="grid2">
            <Picker label="Type" value={form.kind} options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} onChange={(kind) => patch({ kind })} />
            <Picker
              label="Urgency"
              value={form.urgency}
              options={urgencyLabels.map((label, value) => ({ value, label }))}
              onChange={(urgency) => patch({ urgency })}
            />
          </div>
          <label className="switch-row">
            <span>
              No date
              <br />
              <span className="muted small">Keeps it in the Inbox</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={form.undated} onChange={(e) => patch({ undated: e.target.checked })} />
          </label>
          {!form.undated && (
            <>
              <div className="grid2">
                <label className="field">
                  <span className="kicker">Date</span>
                  <input type="date" value={form.date} required onChange={(e) => e.target.value && patch({ date: e.target.value })} />
                  <span className="muted small">{d.bsFirst ? d.bs(form.date) : d.ad(form.date)}</span>
                </label>
                <label className="field">
                  <span className="kicker">Time</span>
                  <input type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} />
                  <span className="muted small">{form.time ? '' : 'All day'}</span>
                </label>
              </div>
              <div className="chips" role="group" aria-label="Quick dates">
                {[
                  { label: 'Today', date: today },
                  { label: 'Tomorrow', date: addDays(today, 1) },
                  { label: 'Next week', date: addDays(today, 7) },
                ].map((c) => (
                  <button type="button" key={c.label} className={form.date === c.date ? 'chip on' : 'chip'} aria-pressed={form.date === c.date} onClick={() => patch({ date: c.date })}>
                    {c.label}
                  </button>
                ))}
                {['09:00', '12:00', '15:00', '18:00', '20:00'].map((t) => (
                  <button type="button" key={t} className={form.time === t ? 'chip on' : 'chip'} aria-pressed={form.time === t} onClick={() => patch({ time: form.time === t ? '' : t })}>
                    {d.num(t)}
                  </button>
                ))}
              </div>
              {lunar ? (
                <p className="muted small">{repeatSummary(r!)}: change this repeat on your phone.</p>
              ) : (
                <div className="stack repeat-box">
                  <div className="grid2">
                    <Picker label="Repeat" value={form.rule} options={ruleOptions} onChange={(rule) => patch({ rule })} />
                    {form.rule !== 'none' && (
                      <label className="field">
                        <span className="kicker">Every</span>
                        <input type="number" min={1} max={99} value={form.interval} onChange={(e) => patch({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
                      </label>
                    )}
                  </div>
                  {form.rule === 'weekly' && (
                    <div className="chips" role="group" aria-label="Weekdays">
                      {weekdayNames.map((n, i) => {
                        const on = form.weekdays.includes(i + 1);
                        return (
                          <button type="button" key={n} className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => patch({ weekdays: on ? form.weekdays.filter((w) => w !== i + 1) : [...form.weekdays, i + 1] })}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.rule !== 'none' && (
                    <div className="grid2">
                      <Picker
                        label="Ends"
                        value={form.end}
                        options={[
                          { value: 'never', label: 'Never' },
                          { value: 'until', label: 'On a date' },
                          { value: 'count', label: 'After a number of times' },
                        ]}
                        onChange={(end) => patch({ end })}
                      />
                      {form.end === 'until' && (
                        <label className="field">
                          <span className="kicker">Last date</span>
                          <input type="date" value={form.until} min={form.date} onChange={(e) => patch({ until: e.target.value })} />
                        </label>
                      )}
                      {form.end === 'count' && (
                        <label className="field">
                          <span className="kicker">Times</span>
                          <input type="number" min={1} max={500} value={form.count} onChange={(e) => patch({ count: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="field">
                <span className="kicker">Alerts</span>
                <div className="chips" role="group" aria-label="Alerts">
                  {alertChoices.map((m) => {
                    const on = form.alerts.includes(m);
                    return (
                      <button type="button" key={m} className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => patch({ alerts: on ? form.alerts.filter((x) => x !== m) : [...form.alerts, m] })}>
                        {alertLabel(m)}
                      </button>
                    );
                  })}
                </div>
                <span className="muted small">Alerts ring on your phone.</span>
              </div>
            </>
          )}
          <div className="field">
            <span className="kicker">Category</span>
            <div className="chips" role="group" aria-label="Category">
              {builtInCategories.map((c) => (
                <button type="button" key={c} className={form.category === c ? 'chip on' : 'chip'} aria-pressed={form.category === c} onClick={() => patch({ category: form.category === c ? '' : c })}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </button>
              ))}
              <input className="chip-input" aria-label="Own category" placeholder="Own…" maxLength={40} value={builtInCategories.includes(form.category as never) ? '' : form.category} onChange={(e) => patch({ category: e.target.value })} />
            </div>
          </div>
          <label className="field">
            <span className="kicker">Description</span>
            <textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </label>
          <section className="sub" aria-label="Steps">
            <h3 className="kicker">Steps</h3>
            {form.steps.length > 0 && (
              <ul className="steps">
                {form.steps.map((s) => (
                  <li key={s.id}>
                    <input type="checkbox" aria-label={`Done: ${s.title}`} checked={s.done} onChange={(e) => patch({ steps: form.steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)) })} />
                    <span className={s.done ? 'task-title done' : ''}>{s.title}</span>
                    <button type="button" className="icon-button small push" aria-label={`Remove step ${s.title}`} onClick={() => patch({ steps: form.steps.filter((x) => x.id !== s.id) })}>
                      <Close size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row">
              <input
                aria-label="New step"
                placeholder="Add a step"
                value={newStep}
                maxLength={200}
                onChange={(e) => setNewStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newStep.trim()) {
                    e.preventDefault();
                    patch({ steps: [...form.steps, { id: crypto.randomUUID(), title: newStep.trim(), done: false }] });
                    setNewStep('');
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                disabled={!newStep.trim()}
                onClick={() => {
                  patch({ steps: [...form.steps, { id: crypto.randomUUID(), title: newStep.trim(), done: false }] });
                  setNewStep('');
                }}
              >
                Add step
              </button>
            </div>
          </section>
        </fieldset>
        {problems.length > 0 && (
          <ul className="error" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="primary" disabled={busy || (!!item && !dirty) || !form.title.trim()}>
            {item ? 'Save changes' : 'Add'}
          </button>
          {dirty && item && (
            <button type="button" className="text" onClick={() => setForm(initial)}>
              Undo changes
            </button>
          )}
        </div>
      </form>

      {item && (
        <section className="sub" aria-label="Notes">
          <h3 className="kicker">Notes</h3>
          {myNotes.length > 0 && (
            <ul className="activity">
              {myNotes.map((n) => (
                <li key={n.id} className="comment">
                  {editing?.id === n.id ? (
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          const result = await repo.editNote(n, editing.body);
                          if (result.status === 'saved') {
                            setEditing(null);
                            onNotes();
                          } else if (result.status === 'invalid') setProblems(result.problems);
                        });
                      }}
                    >
                      <textarea rows={2} value={editing.body} maxLength={4000} autoFocus onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                      <div className="row">
                        <button className="secondary">Save note</button>
                        <button type="button" className="text" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="note-body">{n.body}</p>
                      <span className="muted small note-meta">
                        {new Date(n.created_at_ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        <button className="text small" onClick={() => setEditing({ id: n.id, body: n.body })}>
                          Edit
                        </button>
                        <button className="text small" onClick={() => navigator.clipboard?.writeText(n.body).then(() => say('Note copied.'))}>
                          Copy
                        </button>
                        <button
                          className="text small"
                          onClick={() =>
                            run(async () => {
                              await repo.removeNote(n);
                              onNotes();
                              say('Note deleted.');
                            })
                          }
                        >
                          Delete
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await repo.addNote('task', item.id, note);
                if (result.status === 'saved') {
                  setNote('');
                  onNotes();
                } else if (result.status === 'invalid') setProblems(result.problems);
              });
            }}
          >
            <textarea aria-label="New note" rows={2} placeholder="Add a note" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button className="secondary" disabled={busy || !note.trim()}>
                Add note
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
