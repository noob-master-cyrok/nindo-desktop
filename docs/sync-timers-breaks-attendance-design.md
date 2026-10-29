# Sync design: time sessions, breaks and attendance (for review)

Goal: Nindo Desktop shows the phone's worked time, breaks and attendance, so
its Today's highlights and a Week insights card match the phone. Nothing
here is built or applied yet.

## What syncs, and who can write

| Data | Phone table | Server table | Desktop |
| --- | --- | --- | --- |
| Time sessions (focus rounds, timer runs, manual time) | `planner_sessions` | `planner_sessions` | read only |
| Breaks (the list) and break runs | `breaks`, `break_runs` | `planner_breaks`, `planner_break_runs` | read only |
| Attendance days | `attendance_days` | `planner_attendance` | read, and edit a day's times and note |
| Live running timers, Pomodoro state, take-a-break cover | local only | not synced | not shown |

Why read only for most: the phone owns the clock. Two devices starting and
stopping the same timer would need live state sync, which is a separate and
riskier piece. Past sessions and runs are append-only history, so they sync
safely. Attendance is one row a day, so editing it from the desktop follows
the same later-edit-wins rule as tasks.

## Server (migration 0006, same security model as 0005)

- Tables keyed `(owner_id, id)` (attendance: `(owner_id, day)`), RLS on,
  owner-only `using` + `with check`, no hard deletes, nothing for anon.
- Same `planner_before_write` trigger: ignore stale writes, new revision.
- `planner_sessions`: id, task_id, kind (`focus` / `manual` / `timer`),
  started_at_ms, minutes, created_at_ms, updated_at_ms, deleted_at_ms.
- `planner_breaks`: id, title, description, created/updated/deleted.
- `planner_break_runs`: id, break_id, started_at_ms, ended_at_ms, updated_at_ms, deleted_at_ms.
- `planner_attendance`: day (yyyy-mm-dd), check_in_ms, check_out_ms, note, edited, updated_at_ms, deleted_at_ms.
- Loose limits, like 0005, so one odd phone row can never block later uploads.
- Applied only to the Nindo project (`wvqutuvvbnrnjmjokynf`). "Project 1 Productivity" is not touched.

## Phone (schema 18, next release after 1.5.58)

- Sessions, break runs and attendance get `updatedAt` and a tombstone where
  missing, as 0005 did for links.
- `PlannerSync` gains four types; every write is queued; an upgrade
  backfills the queue so existing history uploads once.
- Tests mirror `planner_sync_test.dart`: push, pull, duplicate prevention,
  tombstones.

## Desktop

- Today's highlights switch from "minutes from history lines" to real
  sessions (overlapping runs counted once, as `sessionShares` does on the
  phone).
- A Week insights card: hours worked per day this week, break time per day,
  attendance hours (check-in to check-out), as on the phone.
- An Attendance card with today's check-in and check-out times and an edit
  sheet.
- A Breaks card listing today's runs.
- Settings and design system unchanged; all new cards use the same tokens.

## Order of work, each step reviewed before the next

1. Migration 0006 written and reviewed. **Apply only on your OK.**
2. Phone sync code and tests, on a branch. **Release only on your OK.**
3. Desktop cards and tests. Publish only after the phone release is out,
   so the cards are not empty.

## Open choices (my defaults in bold)

- Attendance editable from desktop: **yes**.
- Start and stop timers from desktop: **no**, a later step if wanted.
- Calendar items and Nepali/BS stay out of scope here.
