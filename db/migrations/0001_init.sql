-- Tally — initial schema.
-- Ported from tally-build-plan.md §3 to plain Postgres (Neon).
--
-- Two deliberate departures from the plan, both because this is a single-user app
-- with no auth provider:
--   * no `references auth.users(id)` — the user_id columns stay so the schema is
--     portable back to Supabase (or forward to a multi-user world) unchanged.
--   * no RLS policies — there is one user and no public signup. Add them if that
--     ever stops being true.

create extension if not exists pgcrypto;

-- Goals: flat priorities now, self-referencing for the cascade later.
create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  parent_id     uuid references goals(id),
  title         text not null,
  horizon       text not null default 'current',  -- 'current'|'quarter'|'year'|'five_year'|'someday'
  priority_rank smallint,                         -- 1..5, the declared order
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Categories: the ratings layer. Set once, reused forever.
create table if not exists categories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  slug            text not null,
  name            text not null,
  emoji           text,
  energy          smallint not null default 0,   -- -1 drain, 0 neutral, +1 charge
  value_tier      smallint not null default 1,   -- 0 none, 1 low, 2 med, 3 high
  buyback_cost    numeric,                       -- est. $/hr to outsource; null = can't
  default_goal_id uuid references goals(id),
  is_quick        boolean not null default false, -- appears in the Shortcut menu
  sort_order      smallint not null default 0,
  archived_at     timestamptz
);

create unique index if not exists categories_slug_idx
  on categories (user_id, slug);

-- Blocks: the log. ended_at null = currently open.
create table if not exists blocks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  category_id     uuid not null references categories(id),
  goal_id         uuid references goals(id),
  started_at      timestamptz not null,
  ended_at        timestamptz,
  energy_override smallint,
  note            text,
  source          text not null default 'pwa',   -- 'shortcut' | 'pwa' | 'reconcile'
  created_at      timestamptz not null default now(),
  constraint blocks_ordered check (ended_at is null or ended_at > started_at)
);

-- Only one open block at a time. This is the constraint the switch endpoint leans on.
create unique index if not exists one_open_block
  on blocks (user_id) where ended_at is null;

create index if not exists blocks_started_idx
  on blocks (user_id, started_at desc);

-- The response variable. Two taps a day.
-- "Day complete" on the reconcile screen inserts the row with null answers;
-- the daily check then fills them in. A row existing means the day was closed.
create table if not exists daily_check (
  user_id        uuid not null,
  date           date not null,
  energy         smallint,   -- 1..10 end-of-day
  moved_priority boolean,
  note           text,
  primary key (user_id, date)
);

-- Weekly review record. Also the intervention log for the run chart.
create table if not exists reviews (
  user_id    uuid not null,
  week_start date not null,
  snapshot   jsonb,      -- computed totals at time of review
  cutting    text,
  delegating text,
  decisions  text,
  primary key (user_id, week_start)
);
