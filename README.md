# Nindo Desktop

A small web app for your Nindo **Tasks** (the phone's Tasks tab, the planner) on a computer. Sign in with the same email as the phone app. You can see, add and edit tasks with all their details: status, priority, project, labels, start and due dates, estimate, critical, description, sub-tasks, links and comments. The phone picks up changes through its normal sync.

The Tasks tab syncs from the app release after 1.5.56 (database schema 17), using the server tables in `supabase/migrations/0005_planner_sync.sql`. Calendar items (events, reminders, birthdays) are not shown here. The first plan for this app is `docs/desktop-companion-plan.md`.

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

`dist/` is a static site that works from any path. It is published from its own repository, `nindo-desktop`, which holds only this folder (`git subtree split --prefix=desktop`). `.github/workflows/pages.yml` there tests, builds and deploys every push to `main` to GitHub Pages. The build reads the anon key from the repository variable `NINDO_SUPABASE_ANON_KEY`.

To publish a change made in the Nindo repo:

```sh
git subtree push --prefix=desktop desktop-site main
```

(`desktop-site` is the git remote for the `nindo-desktop` repository.) For sign-in links to work, add the site URL to Supabase Auth → URL Configuration → Redirect URLs. The code alone needs no setting, as long as the email template includes `{{ .Token }}`.

GitHub Pages cannot set response headers, so the Content-Security-Policy is a `<meta>` tag in the built `index.html`. It allows scripts and styles from the site only, and connections to the Supabase project only.

## What it does

- **Sign in:** with the code from the email, or the email's sign-in link. The site URL must be in Supabase Auth → Redirect URLs. The desktop never creates accounts (`shouldCreateUser: false`). "Send code" waits 60 seconds between requests. The signed-in email is always shown at the top.
- **Lists:** All tasks, Today (due today or running between start and due), Overdue, Inbox, and one list per project, with open counts. Tasks are grouped by status (In progress, To do, Backlog; Done and Cancelled under "Show done"), critical first, then the phone's manual order. You can also sort by priority or due date, and search titles, labels and descriptions.
- **Status circle:** works like the phone: to do → in progress → done → to do.
- **Task details:** every field the phone has, plus sub-tasks (add, tick, delete), links (add, remove) and the activity log with comments. Changes are recorded in the history the same way the phone records them.
- **New project**, with the phone's colours.
- **Delete** is a soft delete of the task and its sub-tasks, and it reaches the phone.
- **CSV export** of top-level tasks with their sub-tasks, with spreadsheet formula protection.
- The list refreshes when the window gets focus and with Refresh.

## How saving works ("last write wins")

Every save:

1. Reads the task fresh from the server.
2. If its `revision` is not the one you opened, the task changed on another device. Nothing is written. A dialog shows the saved version next to your changes. **Use my changes** puts only your edited fields on top of the saved version. **Discard my changes** keeps the other device's version.
3. Otherwise it copies the fresh row, changes only the fields you edited and keeps everything else exactly as it was (sort order, dates, labels, and any column added later).
4. Sets `updated_at_ms = max(now, previous + 1)`, so a slow computer clock can't make the server ignore the write.
5. Writes with `… where id = ? and revision = ?`. If 0 rows change, the conflict dialog from step 2 appears.

`owner_id`, `revision` and `server_updated_at` are never sent. New tasks get a client uuid; if a retry hits "duplicate key", the existing row is read back. A status change keeps `completed_at_ms` in step, as on the phone.

## Known limits

- **Your tasks appear only once the phone runs the release after 1.5.56.** The first time it opens, it uploads every task, project, link and history line.
- **Whole-task conflicts.** The desktop never overwrites a phone edit it hasn't seen. The phone, though, keeps whichever edit is later by `updated_at_ms`. If you edit a task offline on the phone after editing it on the desktop, the phone's version replaces the desktop's when it syncs.
- **Not instant.** The phone pulls when the app opens or resumes, shortly after a local change, after sign-in, or on "Sync now".
- **Each device uses its own clock** for `updated_at_ms`.
- **Phone-only:** files and photos, timers and focus or time sessions, breaks, attendance and daily-planning settings are not shown here. A task finished on the desktop doesn't stop a timer running for it on the phone until you open that task there.
- **Board drag and reordering** are phone-only for now. New desktop tasks go to the end of their status.

## Tests

- `tests/` unit tests use `tests/fakeStore.ts`, an in-memory copy of the server rules (owner-only rows, revision on every write, stale writes ignored).
- `e2e/smoke.spec.ts` runs the built app with its CSP against `e2e/mockSupabase.ts`. It covers code and link sign-in, the grouped list, all details, an edit, sub-tasks, links, comments, a phone edit causing a conflict, the status circle, creating in a project, and delete.
- The phone side is covered by `test/planner_sync_test.dart` in the Flutter app.
