import { useState } from 'react';
import type { TasksRepo } from '../data/tasksRepo';
import { importColumns, parseImport, type ImportRow } from '../domain/csv';
import type { TaskRow } from '../domain/task';
import { Modal } from './Modal';

const MAX_BYTES = 2_000_000;

/// CSV import: pick a file, see every row checked (a dry run), then add
/// only the valid rows. Nothing is written before "Add".
export function ImportDialog({
  tasks,
  onImported,
  onClose,
}: {
  tasks: TasksRepo;
  onImported: (rows: TaskRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; failed: string[] } | null>(null);
  const [running, setRunning] = useState(false);

  const valid = rows?.filter((r) => r.task) ?? [];
  const invalid = rows?.filter((r) => !r.task) ?? [];

  async function pick(file: File | undefined) {
    setRows(null);
    setProgress(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileProblems(['That file is too large. Import at most 2 MB at a time.']);
      return;
    }
    const result = parseImport(await file.text(), Date.now());
    setFileProblems(result.fileProblems);
    setRows(result.rows);
  }

  async function add() {
    setRunning(true);
    const added: TaskRow[] = [];
    const failed: string[] = [];
    for (const row of valid) {
      try {
        const result = await tasks.insert(row.task!);
        if (result.status === 'saved') added.push(result.row);
        else failed.push(`Line ${row.line}: ${result.status === 'invalid' ? result.problems.join(' ') : 'not added'}`);
      } catch (e) {
        failed.push(`Line ${row.line}: ${e instanceof Error ? e.message : 'not added'}`);
      }
      setProgress({ done: added.length + failed.length, failed: [...failed] });
    }
    setRunning(false);
    onImported(added);
  }

  return (
    <Modal title="Import tasks from CSV" onClose={running ? () => {} : onClose} wide>
      <div className="stack">
        <p className="muted small">
          Columns read: {importColumns.join(', ')}. Only <strong>title</strong> is required, plus <strong>due_date</strong>{' '}
          (yyyy-mm-dd) unless <strong>undated</strong> is true. Steps are separated by “|”; start one with “[x]” to
          mark it done. Every row becomes a new task.
        </p>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => pick(e.target.files?.[0])} disabled={running} />

        {fileProblems.length > 0 && (
          <ul className="error" role="alert">
            {fileProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        {rows && fileProblems.length === 0 && (
          <>
            <p role="status">
              Dry run: <strong>{valid.length}</strong> {valid.length === 1 ? 'task' : 'tasks'} ready to add
              {invalid.length > 0 && (
                <>
                  , <strong>{invalid.length}</strong> {invalid.length === 1 ? 'row has' : 'rows have'} problems and will be
                  skipped
                </>
              )}
              . Nothing has been saved yet.
            </p>
            <div className="table-wrap">
              <table className="preview">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Title</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line} className={row.task ? '' : 'bad'}>
                      <td>{row.line}</td>
                      <td>{row.title || <em>(no title)</em>}</td>
                      <td>{row.task ? (row.task.undated ? 'No date' : row.task.due_date_ad) : '—'}</td>
                      <td>{row.task ? 'Ready' : row.problems.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {progress && (
          <div role="status">
            <p>
              Added {progress.done - progress.failed.length} of {valid.length}.
            </p>
            {progress.failed.length > 0 && (
              <ul className="error">
                {progress.failed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="row end">
          <button onClick={onClose} disabled={running}>
            {progress && !running ? 'Done' : 'Cancel'}
          </button>
          {!progress && (
            <button className="primary" disabled={running || valid.length === 0} onClick={add}>
              Add {valid.length} {valid.length === 1 ? 'task' : 'tasks'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
