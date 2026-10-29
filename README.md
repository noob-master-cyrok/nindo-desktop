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

`dist/` is a static site that works from any path. It is published from its own public repository, [noob-master-cyrok/nindo-desktop](https://github.com/noob-master-cyrok/nindo-desktop), which holds only this folder. `.github/workflows/pages.yml` there tests, builds and deploys every push to `main` to https://noob-master-cyrok.github.io/nindo-desktop/. The build reads the anon key from the repository variable `NINDO_SUPABASE_ANON_KEY`.

To publish what is committed here:

```sh
desktop/scripts/publish.sh
```

The script needs a git remote `desktop-site` for that repository. It adds one commit on top of its `main`, so that repository's history is never rewritten.

## What it does

It follows the phone's Tasks tab and the Nindo design system (`docs/replicate/03-design-system.md`, tokens from `lib/app/theme/`). The audit behind this is in `docs/parity-audit-2026-10-29.md`.

- **Sign in:** with the code from the email, or the email's sign-in link. The site URL must be in Supabase Auth → Redirect URLs. The desktop never creates accounts (`shouldCreateUser: false`). "Send code" waits 60 seconds between requests. The signed-in email is shown at the bottom of the sidebar.
- **Lists:** All tasks, Today (due today or running between start and due), Overdue, Inbox, and one list per project, with open counts.
- **Summary strip:** Open, In progress, Overdue and Done this week, as on the phone.
- **Daily planning:** today's Daily planning task (made by the phone) with Start and Finish. The phone's timer and Insights minutes are not started from here.
- **Quick add:** type and press Enter; the sliders button opens the full New task panel with what was typed.
- **List view:** sections by status in board order (Backlog, To do, In progress, Done, Cancelled; Done and Cancelled start collapsed), tasks grouped by project inside each status (Inbox last) unless one list is picked. Rows are ruled, with the status circle, critical flame, priority bars, estimate, project, due date (red when overdue), sub-task count and up to three labels.
- **Board view:** a column per status. Drag a card onto a column, or onto another card to land just before it; + adds a task straight into a column.
- **Filter and sort:** priorities, labels, due (overdue, today, next 7 days, no date), show done and cancelled; sort by my order, due date, priority or last changed (open critical tasks first except in my order). Search matches every word.
- **Status circle:** to do → in progress → done → to do.
- **Task details:** every field the phone has, plus sub-tasks (add, tick, delete), links (add, remove) and the activity log with comments. Changes are recorded in the history the same way the phone records them. **Duplicate** copies the task with its sub-tasks and links, as to do. **Delete** is a soft delete of the task and its sub-tasks with **Undo** in the toast.
- **Today's highlights:** what got done (or worked on, or dropped) today, the major tasks first, with its own filter. Minutes worked come from today's focus and time lines in each task's history.
- **Settings:** Appearance (System, Light, Dark), App colors (the phone's six and a custom colour kept at AA contrast), Background (White, Paper, Mist, Sky, Mint, Blush or custom; light mode only) and Numerals (123 or १२३). They are kept on this computer.
- **Timers:** start a timer on any row (several at once) or in the task panel; Pause logs whole minutes as a time session, the rest carries over. Focus rounds of 15, 25, 45 or 50 minutes end with a 5-minute rest. A full-screen black clock shows what runs. Timers keep running across reloads and tabs on this computer, and closing a task pauses its timer.
- **Time log:** every session for a task (from here or the phone), add time by hand, remove one.
- **Breaks:** Take a break pauses every timer and covers the page until End break; the break and its run sync to the phone.
- **Attendance:** Check in and Check out once a day, or set any day by hand.
- **This week:** worked, break and at-work hours per day.
- **Keys:** N adds a task, / searches, Escape closes the task or the full-screen clock.
- **New project**, with the phone's colours, and **CSV export** with spreadsheet formula protection.
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
- **Running clocks are per device.** A timer started here does not show as running on the phone (and the other way round); the time it logs does sync. Files, photos and daily-planning settings stay on the phone.
- **Dates are AD only.** The phone can show BS first; that needs its verified BS tables ported here.
- **English only.** The phone's Nepali text is not here yet; Numerals १२३ works.

## Tests

- `tests/` unit tests use `tests/fakeStore.ts`, an in-memory copy of the server rules (owner-only rows, revision on every write, stale writes ignored).
- `e2e/smoke.spec.ts` runs the built app with its CSP against `e2e/mockSupabase.ts`. It covers code and link sign-in, the grouped list, all details, an edit, sub-tasks, links, comments, a phone edit causing a conflict, the status circle, creating in a project, delete and Undo, duplicate, quick add, a board drag, the filter, and settings that stay after a reload.
- `SCREENS=1 npx playwright test screens` saves light and dark screenshots of every screen to `test-results/screens/` for design reviews.
- The phone side is covered by `test/planner_sync_test.dart` in the Flutter app.
