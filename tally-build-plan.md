# Tally — Build Plan

A personal time-audit and goal-alignment tool. Single user. Phone captures, desktop analyzes.

> Placeholder name — rename before scaffolding if you want something else.

---

## 1. Design principles

These are constraints, not preferences. Violating them is how this class of tool dies.

1. **One tap = one switch.** The app never asks for a duration. It asks what you are doing now and computes the rest.
2. **Phone is write-only.** No reports, charts, totals, or history in the mobile view. Nothing to scroll.
3. **Ratings live on categories, not blocks.** Energy and value are set once per category. Per-block override exists but is rare.
4. **Best capture path never opens a browser.** iOS Shortcut → edge function for common categories.
5. **The day has an end state.** Reconcile marks the day complete and says so. No reason to linger.
6. **No streaks, badges, or gamification.** The reward is the weekly report, not the app.
7. **Baseline before intervention.** Four weeks of logging with zero changes. The tool should actively discourage cutting things in week one.

---

## 2. Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind, deployed on Vercel
- **Backend:** Supabase (Postgres, Auth, Edge Functions)
- **Auth:** Supabase magic link, single user. RLS on with a simple `auth.uid() = user_id` policy — cheap insurance even for one user.
- **Mobile:** PWA (installed to home screen, standalone display mode) + iOS Shortcut hitting a token-authenticated edge function
- **Charts:** Recharts

---

## 3. Schema

```sql
-- Categories: the ratings layer. Set once, reused forever.
create table categories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  name          text not null,
  emoji         text,
  energy        smallint not null default 0,   -- -1 drain, 0 neutral, +1 charge
  value_tier    smallint not null default 1,   -- 0 none, 1 low, 2 med, 3 high
  buyback_cost  numeric,                       -- est. $/hr to outsource; null = can't
  default_goal_id uuid references goals(id),
  is_quick      boolean not null default false, -- appears in Shortcut menu
  sort_order    smallint not null default 0,
  archived_at   timestamptz
);

-- Blocks: the log. ended_at null = currently open.
create table blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  category_id   uuid not null references categories(id),
  goal_id       uuid references goals(id),
  started_at    timestamptz not null,
  ended_at      timestamptz,
  energy_override smallint,
  note          text,
  source        text not null default 'pwa',  -- 'shortcut' | 'pwa' | 'reconcile'
  created_at    timestamptz not null default now()
);

-- Only one open block at a time.
create unique index one_open_block
  on blocks (user_id) where ended_at is null;

create index blocks_started_idx on blocks (user_id, started_at desc);

-- Goals: flat priorities now, self-referencing for the cascade later.
create table goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  parent_id     uuid references goals(id),
  title         text not null,
  horizon       text not null default 'current', -- 'current'|'quarter'|'year'|'five_year'|'someday'
  priority_rank smallint,                        -- 1..5, the declared order
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- The response variable. Two taps a day.
create table daily_check (
  user_id         uuid not null references auth.users(id),
  date            date not null,
  energy          smallint,        -- 1..10 end-of-day
  moved_priority  boolean,         -- did I move a top priority
  note            text,
  primary key (user_id, date)
);

-- Weekly review record. Also the intervention log for the run chart.
create table reviews (
  user_id       uuid not null references auth.users(id),
  week_start    date not null,
  snapshot      jsonb,     -- computed totals at time of review
  cutting       text,
  delegating    text,
  decisions     text,
  primary key (user_id, week_start)
);
```

**Views to build:** `v_block_durations` (adds computed minutes, handles open block as now()), `v_category_rollup` (hours + energy + value per category per week), `v_goal_allocation` (hours per goal per week, joined to `priority_rank`).

**Seed categories** (edit to taste): Deep work, Meetings, Email/admin, Commute, Household chores, Kids — active, Kids — logistics, Exercise, Meals, Errands, Personal projects, Social/family, Media/scroll, Sleep.

---

## 4. The capture endpoint

The Shortcut path is the important one. A single edge function:

```
POST /functions/v1/switch
Authorization: Bearer <long-lived personal token>
Body: { "category": "deep_work" }  // slug or id

Behavior:
  1. Close the currently open block (ended_at = now())
  2. Open a new block with the given category
  3. Return { ok: true, closed: {name, minutes}, now: {name} }
```

Idempotency: if the requested category is already open, do nothing and return the existing block. Prevents double-tap fragmenting the log.

The Shortcut is: Choose from Menu (6 `is_quick` categories) → Get Contents of URL (POST) → Show Notification with `now.name` → end. No app opens. Assign it to the Action Button or Back Tap.

---

## 5. Screens

### Mobile (PWA) — three screens, no navigation bar

**Capture.** Full-bleed grid of large category tiles, `is_quick` first. Header strip: "Deep work · 47m". Tap → POST, haptic, brief confirmation, auto-return to a dismissed state. If the open block exceeds 90 minutes, the header becomes a prompt: "Still deep work?" / "Split it" — split opens a minimal time picker defaulting to the midpoint.

**Reconcile.** One horizontal strip of the day, proportional. Tap a segment to change category or drag its edges. Gaps highlighted in red. A "Day complete" button that closes the day.

**Daily check.** Appears after reconcile. Energy 1–10 as a row of taps, one yes/no on whether you moved a priority, optional note. Then the app says done and offers nothing else.

### Desktop — reports only

**Allocation vs. intention.** Hours per goal for the week, sorted by actual, with declared `priority_rank` shown alongside. The gap is the whole point; make it visually loud.

**DRIP quadrant.** Scatter of categories on energy (x) × value (y), bubble sized by weekly hours. Below it, the actionable table: low-value categories sorted by hours descending, with `buyback_cost` × hours as an estimated monthly cost of doing it yourself. That table is your outsourcing queue.

**Run chart.** Daily energy and `moved_priority` over time, with vertical markers at each `reviews.week_start` that recorded a change. Your control chart — this is what tells you whether an intervention actually did anything.

**Weekly review.** Auto-generated agenda: top three low-value drains by hours, largest allocation gap, changes made last week and what the response did since. Free-text fields write back to `reviews`.

---

## 6. Milestones

| M | Scope | Done when |
|---|---|---|
| M0 | Repo, Supabase project, auth, migrations, seed categories | You can log in and see an empty capture grid |
| M1 | Switch endpoint + capture screen + Shortcut | A full day logs from your phone without opening a browser |
| M2 | Long-block prompt, reconcile strip, day-complete | You can fix a day you half-forgot in under 60 seconds |
| M3 | Goals (flat, 3–5), category→goal mapping, daily check | Response variable is being collected |
| M4 | Desktop reports: allocation, DRIP, run chart | End of baseline week 4, first real look at the data |
| M5 | Weekly review generator writing to `reviews` | Review runs itself from the data |

**M4 ships at the end of week 4, not before.** Building the reports early guarantees you'll look at them early, and looking early guarantees you'll start changing things before you have a baseline. Log first.

---

## 7. Claude Code prompt sequence

Run these as separate sessions with a commit between each. Point your global `CLAUDE.md` conventions at the repo first.

**Session 1 — scaffold**
> Initialize a Next.js App Router + TypeScript + Tailwind project called `tally`, configured for Vercel. Add the Supabase JS client with magic-link auth for a single user, a protected layout, and a middleware redirect for unauthenticated users. Write `supabase/migrations/0001_init.sql` from the schema in `docs/build-plan.md` section 3, including the partial unique index and RLS policies. Add a seed script for the starter categories. No UI beyond a login page and an empty authenticated shell.

**Session 2 — capture core**
> Implement the switch endpoint as a Supabase edge function per section 4, including the idempotency rule and a long-lived bearer token read from env. Then build the mobile capture screen: a full-bleed tile grid, quick categories first, showing the currently open block and its elapsed minutes in a header. Tapping a tile calls the endpoint optimistically and shows a brief confirmation. Configure the PWA manifest for standalone display. Mobile only — do not build any desktop view or any chart.

**Session 3 — repair and reconcile**
> Add the 90-minute long-block prompt with a split action defaulting to the midpoint. Build the reconcile screen: a proportional horizontal strip of the day's blocks, tappable to recategorize, draggable edges to adjust boundaries, gaps highlighted. Add a day-complete action and the daily check screen (energy 1–10, moved-priority boolean, optional note) writing to `daily_check`.

**Session 4 — goals**
> Add goal CRUD limited to five active goals at `horizon = 'current'`, each with a `priority_rank`. Add a `default_goal_id` selector on categories. When a block is created, inherit `goal_id` from its category. Keep `parent_id` and the other horizon values in the schema but do not expose them in the UI yet.

**Session 5 — reports** *(hold until baseline is done)*
> Build the desktop report views per section 5 using Recharts, plus the SQL views in section 3. Three pages: allocation vs. intention, DRIP quadrant with the outsourcing cost table, and the run chart with intervention markers. Desktop breakpoints only — these routes should redirect to the capture screen on narrow viewports.

**Session 6 — weekly review**
> Build the weekly review page that computes the agenda (top three low-value drains by hours, largest allocation gap, prior-week changes with subsequent response movement), renders it read-only, and takes free-text input for cutting / delegating / decisions, persisting to `reviews` along with a `snapshot` jsonb of the computed figures.

---

## 8. Protocol

**Weeks 1–4 — screening.** Log everything. Change nothing. Set category energy and value ratings in week 1 and resist re-tuning them; you're measuring the world, not the instrument. Expect week 1 to be bad data as the capture habit forms — plan to discard it.

**Week 4 — first read.** Reports go live. Look for main effects: which categories dominate hours, which dominate drains, where allocation diverges most from declared priority.

**Weeks 5+ — one or two changes at a time.** Cut or delegate, record it in the weekly review, watch the run chart. Same discipline as any characterization study — confound three changes at once and you learn nothing.

**Quarterly.** Revisit goals. By now you have four weeks of energy data showing what actually charges you, which is the input the longer-horizon cascade was always supposed to have.
