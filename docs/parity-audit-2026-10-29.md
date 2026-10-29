# Nindo Desktop: feature and design audit (2026-10-29)

Compared the desktop site (`desktop/`, as published 2026-10-27) with the
phone's Tasks tab in 1.5.58 (`lib/features/planner/`) and the design system
(`docs/replicate/03-design-system.md`, `lib/app/theme/`). Desktop shows only
the Tasks tab, as Safu chose on 2026-10-27.

Status: ✅ fixed on branch `desktop-parity` · ⏸ not done yet (needs new syncing or a bigger port; Safu decides)

Not changed on purpose: the desktop keeps a left sidebar of lists (All, Today,
Overdue, Inbox, projects) instead of the phone's bottom tab bar and filter
chip, and opens a task in a side panel instead of a pushed page. Both are the
desktop form of the same screens.

## Design system gaps

| # | Gap | Phone | Desktop before | |
|---|---|---|---|---|
| D1 | Colour tokens | `ink2`, `rule2`, `accInk`, `accTint`, `attnTint`, `seg` and exact dark values | Missing tokens; dark mute, rule, accent, done, attn, danger and on-accent all off | ✅ |
| D2 | Background | White by default since 1.5.53, plus Paper, Mist, Sky, Mint, Blush or custom | Old warm paper only | ✅ |
| D3 | App colours | Raspberry, Indigo, Teal, Forest, Saffron, Plum or custom, kept at AA contrast | Raspberry only | ✅ |
| D4 | Light / dark | System, or picked | System only | ✅ |
| D5 | Type scale | Tab title 40/600 tracking −1, rows 16/400, kickers 11/500 upper-case tracked, mono numbers | 28/20/16 headings, bold rows, accent kickers | ✅ |
| D6 | Lists | Ruled rows (hairlines), no boxes | Every row a bordered card | ✅ |
| D7 | Buttons | Stadium shape, primary accent, secondary outlined ink, links in `accInk` | 8 px corners, underlined accent links | ✅ |
| D8 | Status icons | Circle, half-filled circle, filled check, cross circle, hex grid; to do in `ink2` | Unicode glyphs (backlog almost invisible) | ✅ |
| D9 | Priority | Linear-style bars, red warning square for urgent | Coloured words | ✅ |
| D10 | Critical | Flame pill on a danger tint | Outlined upper-case box | ✅ |
| D11 | Row meta | Timer + estimate, project dot, calendar + "Today"/date (red when overdue), sub-task count, up to 3 label chips then +N | No estimate, "#label" tags, words for priority | ✅ |
| D12 | Section heads | Status icon, kicker, count, chevron; Done and Cancelled collapsed | Bold text; done hidden behind a checkbox | ✅ |
| D13 | Toasts | Inverted ink pill with Undo | Inline banners | ✅ |
| D14 | Radii and spacing | 8/12/16/20/24, 8-point spacing, page margin 20 | Mostly fine; dialogs 16 | ✅ |

## Tasks tab feature gaps

| # | Feature on the phone | Desktop before | |
|---|---|---|---|
| F1 | Status order backlog → to do → in progress → done → cancelled | In progress first | ✅ |
| F2 | Tasks grouped by project inside each status (Inbox last) | Flat | ✅ |
| F3 | Summary strip: Open, In progress, Overdue, Done this week | None | ✅ |
| F4 | Quick add (type, Enter) and the full New task window | New task button only | ✅ |
| F5 | Board view with columns, drag to move, + per column | None | ✅ |
| F6 | Filter: priorities, labels, due (overdue, today, this week, no date), show done | Sidebar lists only | ✅ |
| F7 | Sort: manual, due, priority, recently updated; open critical first except manual; search matches every word | 3 sorts, critical first in manual too, plain substring search | ✅ |
| F8 | Today's highlights (done, worked on or dropped today, major first, with its own filter) | None | ✅ (time worked comes from the focus and time lines in each task's history) |
| F9 | Daily planning card with Start and Finish | Shown only as a plain task | ✅ |
| F10 | Duplicate a task (with sub-tasks and links, "(copy)") | None | ✅ |
| F11 | Delete with Undo | Confirm dialog, no Undo | ✅ |
| F12 | Numerals 123 / १२३ | Latin only | ✅ |
| F13 | Keyboard (desktop only): N new task, / search, Esc close | None | ✅ |
| F14 | Task timers, focus rounds (Pomodoro) and running rows | Phone-only data | ⏸ |
| F15 | Take a break, break cover, Breaks card and Break insight | Phone-only data | ⏸ |
| F16 | Attendance check in/out and its insight | Phone-only data | ⏸ |
| F17 | Week insights (hours against goals) | Needs timer sessions | ⏸ |
| F18 | Files and photos on tasks | Phone-only data | ⏸ |
| F19 | Nepali language | English only | ⏸ (big; separate piece of work) |
| F20 | BS dates (calendar first: BS) | AD only | ⏸ (needs the phone's verified BS tables ported) |

F14 to F18 need new Supabase tables and a phone release that uploads timers,
sessions, breaks and attendance. Calendar, Today, events, reminders and
alarms stay off the desktop, as chosen on 2026-10-27.
