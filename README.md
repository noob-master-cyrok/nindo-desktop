# Nindo Desktop

A small web app for working on your Nindo tasks from a computer. Sign in with the same email as the phone app, then view, add, edit, complete and delete your own tasks and their notes. The phone picks up changes through its normal sync. The plan it follows is `docs/desktop-companion-plan.md`.

The Flutter app and the database schema are unchanged. This folder is separate from the Flutter app.

## Setup

```sh
cd desktop
cp .env.example .env.local     # fill in the anon key from release.env.json
npm install
npm run dev                    # http://localhost:5173
```

Only the public URL and the **anon** key are used. They are public by design, and row-level security limits every query to the signed-in account. A secret or service-role key must never go in this folder. `npm run check:secrets` runs before and after every build and fails if one turns up.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (vitest): validation, write rules, conflicts, CSV, filters |
| `npm run build` | Secret check, type check, production build in `dist/` with the Content-Security-Policy, secret check of the bundle |
| `npm run e2e` | Builds, serves `dist/` and runs the Playwright smoke test against a mocked Supabase (installed Google Chrome; `PW_CHANNEL=chromium` for Playwright's own) |

## Hosting

`dist/` is a static site that works from any path. Deploy it to GitHub Pages, Netlify or Vercel. Sign-in uses an emailed code rather than a link, so no redirect URL needs to be added in Supabase Auth.

GitHub Pages cannot set response headers, so the Content-Security-Policy is a `<meta>` tag in the built `index.html`. It allows scripts and styles from the site only, and connections to the Supabase project only.

## What it does

- **Sign in:** emailed one-time code, the same as the phone. The desktop never creates accounts (`shouldCreateUser: false`). "Send code" waits 60 seconds between requests. The signed-in email is always shown at the top.
- **Tasks:** All open / Today / Upcoming / Overdue / No date / Completed, title search, sort by due date or urgency, and "last changed" from `server_updated_at`. The list refreshes when the window gets focus and with the Refresh button.
- **Edit:** title, AD date, time, no date, urgency, category, alert minutes, steps (add, rename, reorder, tick, remove; ids kept) and notes. Repeat rules are shown but can't be edited here.
- **Complete / reopen** one-off tasks. **Delete** is a soft delete, needs confirmation, and is final.
- **Notes** (`item_notes`) on each task: add, edit, delete.
- **CSV export** with spreadsheet formula protection. **CSV import** checks every row first (dry run), shows the problems for each line, and adds only valid rows as new tasks.

## How saving works ("last write wins")

Every save:

1. Reads the task fresh from the server.
2. If its `revision` is not the one you opened, the task changed on another device. Nothing is written. A dialog shows the saved version next to your changes. **Use my changes** puts only your edited fields on top of the saved version. **Discard my changes** keeps the other device's version.
3. Otherwise it copies the fresh row, changes only the fields you edited and keeps everything else exactly as it was (sound, tithi data, alert offsets, exceptions, step ids, and any column added later).
4. Sets `updated_at_ms = max(now, previous + 1)`, so a slow computer clock can't make the server ignore the write.
5. Writes with `… where id = ? and revision = ?`. If 0 rows change, the conflict dialog from step 2 appears.

`owner_id`, `revision` and `server_updated_at` are never sent. New tasks get a client uuid; if a retry hits "duplicate key", the existing row is read back.

## Known limits

- **Whole-task conflicts.** The desktop never overwrites a phone edit it hasn't seen. The phone, though, keeps whichever edit is later by `updated_at_ms`. If you edit a task offline on the phone after editing it on the desktop, the phone's version replaces the desktop's when it syncs.
- **Not instant.** The phone pulls when the app opens or resumes, shortly after a local change, after sign-in, or on "Sync now". There's no background poll.
- **Each device uses its own clock** for `updated_at_ms`.
- **Repeating tasks can't be completed here.** On the phone, completing one moves it to its next date, and the desktop doesn't calculate recurrences yet. Completing a whole series here would end it.
- **No XP for desktop completions.** XP is phone-only.
- **Phone-only data** (timers, Planner status and groups, breaks, alarms, custom sounds) is not visible here and is never touched.
- **Imported Google Calendar events** are shown read-only.
- **Dates are AD only for now.** BS display and a BS date picker are Phase 2. Tasks set in BS on the phone keep their BS meaning; the editor says so.

## Tests

- `tests/` unit tests use `tests/fakeStore.ts`, an in-memory copy of the server rules (owner-only rows, revision on every write, stale writes ignored, tombstones final).
- `e2e/smoke.spec.ts` runs the built app with its CSP against `e2e/mockSupabase.ts`. It covers sign in, create, edit, a phone edit causing a conflict, notes, complete, the repeating-task guard and delete.
- `supabase/tests/rls_test.sql` (run with `supabase test db`) covers cross-user isolation, the revision guard and final tombstones on a real Postgres.
- The phone interop checks in section 8.4 of the plan need a real device and account.
