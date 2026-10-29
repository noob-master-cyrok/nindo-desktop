import { useState, type ReactNode } from 'react';
import { groupByProject, statusLabels, statuses, type PlannerTask, type Project, type Status } from '../domain/planner';
import { useSettings } from '../settings';
import { Plus, StatusIcon } from './Icons';

/// Columns by status, side by side. A card dragged onto another column, or
/// between two cards, moves there; + adds a task straight into a column.
export function Board({
  columns,
  projects,
  grouped,
  groupHeader,
  tile,
  onMove,
  onAdd,
}: {
  columns: Record<Status, PlannerTask[]>;
  projects: Project[];
  grouped: boolean;
  groupHeader: (projectId: string | null, count: number) => ReactNode;
  tile: (task: PlannerTask) => ReactNode;
  /// [beforeId]: the card it was dropped on, or null for the column's end.
  onMove: (id: string, status: Status, beforeId: string | null) => void;
  onAdd: (status: Status, title: string) => void;
}) {
  const { num } = useSettings();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const [title, setTitle] = useState('');

  const drop = (status: Status, beforeId: string | null) => {
    if (dragging && dragging !== beforeId) onMove(dragging, status, beforeId);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="board" aria-label="Board">
      {statuses.map((s) => {
        const list = columns[s];
        const groups = grouped ? groupByProject(list, projects) : [{ projectId: null, tasks: list }];
        return (
          <section
            key={s}
            className={over === s ? 'column over' : 'column'}
            aria-label={statusLabels[s]}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(s, null);
            }}
          >
            <header className="column-head">
              <span className={`s-${s}`}>
                <StatusIcon status={s} size={16} />
              </span>
              <h2 className="kicker">{statusLabels[s]}</h2>
              <span className="count">{num(list.length)}</span>
              <button
                type="button"
                className="icon-button small push"
                aria-label={`Add a task to ${statusLabels[s]}`}
                title="Add a task"
                onClick={() => {
                  setAdding(s);
                  setTitle('');
                }}
              >
                <Plus size={16} />
              </button>
            </header>
            {adding === s && (
              <form
                className="column-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (title.trim()) onAdd(s, title.trim());
                  setAdding(null);
                }}
              >
                <input
                  autoFocus
                  aria-label={`New task in ${statusLabels[s]}`}
                  placeholder="Task title"
                  maxLength={300}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                  onBlur={() => !title.trim() && setAdding(null)}
                />
              </form>
            )}
            <div className="column-body">
              {groups.map((g) => (
                <div key={g.projectId ?? 'inbox'} className="column-group">
                  {grouped && groupHeader(g.projectId, g.tasks.length)}
                  {g.tasks.map((t) => (
                    <div
                      key={t.id}
                      className={dragging === t.id ? 'drag-item dragging' : 'drag-item'}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', t.id);
                        setDragging(t.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Dropped on a card: it goes just before it.
                        drop(s, t.id);
                      }}
                    >
                      {tile(t)}
                    </div>
                  ))}
                </div>
              ))}
              {list.length === 0 && <p className="column-empty muted small">Drop tasks here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
