import { useState } from 'react';
import { dueLabels, noFilter, priorityLabels, sortLabels, type Due, type Filter, type Sort } from '../domain/planner';
import { PriorityIcon } from './Icons';
import { Modal } from './Modal';

/// The phone's filter sheet: sort, priorities, labels, due and done.
export function FilterDialog({
  filter,
  sort,
  labels,
  onApply,
  onClose,
}: {
  filter: Filter;
  sort: Sort;
  labels: string[];
  onApply: (filter: Filter, sort: Sort) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState(filter);
  const [s, setS] = useState(sort);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Modal title="Filter" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(f, s);
        }}
      >
        <fieldset className="set-group">
          <legend className="kicker">Sort</legend>
          <div className="chips">
            {(Object.keys(sortLabels) as Sort[]).map((k) => (
              <button type="button" key={k} className="chip" aria-pressed={s === k} onClick={() => setS(k)}>
                {sortLabels[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="set-group">
          <legend className="kicker">Priority</legend>
          <div className="chips">
            {[4, 3, 2, 1, 0].map((p) => (
              <button
                type="button"
                key={p}
                className="chip"
                aria-pressed={f.priorities.includes(p)}
                onClick={() => setF({ ...f, priorities: toggle(f.priorities, p) })}
              >
                <PriorityIcon priority={p} size={14} /> {priorityLabels[p]}
              </button>
            ))}
          </div>
        </fieldset>

        {labels.length > 0 && (
          <fieldset className="set-group">
            <legend className="kicker">Labels</legend>
            <div className="chips">
              {labels.map((l) => (
                <button
                  type="button"
                  key={l}
                  className="chip"
                  aria-pressed={f.labels.includes(l)}
                  onClick={() => setF({ ...f, labels: toggle(f.labels, l) })}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="set-group">
          <legend className="kicker">Due</legend>
          <div className="chips">
            {(Object.keys(dueLabels) as Due[]).map((d) => (
              <button type="button" key={d} className="chip" aria-pressed={f.due === d} onClick={() => setF({ ...f, due: d })}>
                {dueLabels[d]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="switch-row">
          <span>Show done and cancelled</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={f.showClosed}
            onChange={(e) => setF({ ...f, showClosed: e.target.checked })}
          />
        </label>

        <div className="row end">
          <button
            type="button"
            className="text push-right"
            onClick={() => {
              setF(noFilter);
              setS('manual');
            }}
          >
            Clear
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Show tasks</button>
        </div>
      </form>
    </Modal>
  );
}
