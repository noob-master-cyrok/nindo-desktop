import { useEffect, useState } from 'react';
import type { NoteRow, NotesRepo } from '../data/notesRepo';
import type { SaveResult } from '../data/tasksRepo';
import { relativeTime } from '../domain/filters';
import { ConflictDialog } from './ConflictDialog';
import { Confirm } from './Modal';

/// Notes attached to one task (`item_notes`, parent_type = task).
export function NotesPanel({ taskId, notes, readOnly }: { taskId: string; notes: NotesRepo; readOnly: boolean }) {
  const [list, setList] = useState<NoteRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ note: NoteRow; body: string } | null>(null);
  const [conflict, setConflict] = useState<{ current: NoteRow; body: string } | null>(null);
  const [deleting, setDeleting] = useState<NoteRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setList(await notes.forTask(taskId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notes.');
    }
  }

  useEffect(() => {
    load();
  }, [taskId]);

  async function run(action: () => Promise<SaveResult<NoteRow>>, body?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result.status === 'invalid') setError(result.problems.join(' '));
      if (result.status === 'conflict') setConflict({ current: result.current, body: body ?? '' });
      if (result.status === 'gone') setError('That note was deleted on another device.');
      if (result.status === 'saved') {
        setEditing(null);
        setDraft('');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notes" aria-label="Notes">
      <h3>Notes</h3>
      {list === null && !error && <p className="muted small">Loading…</p>}
      {list?.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="note-list">
        {list?.map((note) => (
          <li key={note.id}>
            {editing?.note.id === note.id ? (
              <div className="stack">
                <textarea
                  rows={3}
                  maxLength={4000}
                  aria-label="Edit note"
                  value={editing.body}
                  onChange={(e) => setEditing({ note, body: e.target.value })}
                />
                <div className="row">
                  <button
                    className="primary"
                    disabled={busy || !editing.body.trim()}
                    onClick={() => run(() => notes.update(note, editing.body), editing.body)}
                  >
                    Save note
                  </button>
                  <button onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <p className="note-body">{note.body}</p>
                <div className="row small muted">
                  <span>{relativeTime(note.server_updated_at, Date.now())}</span>
                  {!readOnly && (
                    <>
                      <button className="link" onClick={() => setEditing({ note, body: note.body })}>
                        Edit
                      </button>
                      <button className="link danger-text" onClick={() => setDeleting(note)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="stack">
          <textarea
            rows={2}
            maxLength={4000}
            placeholder="Add a note"
            aria-label="New note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div>
            <button disabled={busy || !draft.trim()} onClick={() => run(() => notes.create(taskId, draft))}>
              Add note
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {conflict && (
        <ConflictDialog
          current={conflict.current}
          mine={{ body: conflict.body }}
          onKeepTheirs={() => {
            setConflict(null);
            setEditing(null);
          }}
          onApplyMine={() => {
            const { current, body } = conflict;
            setConflict(null);
            run(() => notes.update(current, body), body);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete this note?"
          body={<p>It will also be removed from your phone. This cannot be undone.</p>}
          action="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const note = deleting;
            setDeleting(null);
            run(() => notes.remove(note));
          }}
        />
      )}
    </section>
  );
}
