# Analytics & the workspace overview

`bk issues analytics` answers "how is this workspace doing". Run it with no flags
for the workspace summary; `--json` / `--yaml` give the full payload.

## The overview report

```
bk issues analytics --view overview --range 30d
```

One call returns everything the web Overview page shows: KPIs with their change
against the start of the range, a member leaderboard, project health, four
attention lists (overdue, urgent, open too long, unassigned), workload per
assignee and the recent-activity feed. `--json` returns all of it, including the
per-period figures the table does not print — read that for anything you compute
on.

`--range 7d|30d|90d|all` is shorthand for `--from/--to` (now minus N days up to
now, UTC). It works with every view, and combining it with `--from`/`--to` is an
error. `all` sends no window. `--view overview` takes ONLY the window: `--id`,
`--interval` and the `--status/--priority/--label/--assignee` filters are
rejected rather than silently ignored, because an unfiltered report that reads
like a filtered one is worse than an error. Run `bk meta` for the vocabularies
(statuses, priorities); do not assume them.

## What the numbers mean

- **Completed** is per assignee: an issue with three assignees counts once for
  each of them, so the members' completions can add up to more than the
  workspace total.
- **Created** is by reporter, and an issue has one.
- **Open** on the leaderboard and in workload is a snapshot of now, not of the
  range.
- **Avg cycle** is the mean of created-to-completed over the issues counted as
  that member's completions. A dash means none.
- **Comments** counts comments posted; **activity** counts every recorded action
  the member took.
- The leaderboard is ranked by completed for the range, then created. A `*` marks
  the leader of a metric; a tie marks every tied member, and nobody is marked
  for a metric whose best value is zero.
- The period matrix (this week, this month, last month, this year, last year, all
  time) is calendar-based in UTC, and a week starts on Monday. Cells read
  `created/completed`.
- KPI changes for total, open, overdue, unassigned and completion rate are
  reconstructed from timestamps. They cannot see an assignment or due date that
  was changed afterwards, so treat them as approximate.

Related commands: `bk issues analytics`, `bk meta`
