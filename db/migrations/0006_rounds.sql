-- Rounds — periodic chores, planned rather than remembered.
--
-- Second app, same repo, same database. It shares Tally's user_id and session
-- cookie and nothing else: no foreign keys cross into blocks or categories, so
-- either app can be lifted out without dragging the other with it.
--
-- The model is deliberately small. A chore is a name and an interval. Everything
-- else — when it is due, what is overdue, what this week looks like — is derived
-- from the completions, because a stored "next due" date is a second source of
-- truth that goes stale the moment you do a chore early.

-- The list, and how often each thing comes round.
create table if not exists chores (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  slug           text not null,
  name           text not null,
  area           text,                              -- 'kitchen'|'bathroom'|'outside'|… free text, used to group the list
  interval_days  smallint not null,                 -- comes round every N days
  effort_minutes smallint not null default 15,      -- what the planner budgets against
  prefer_weekend boolean not null default false,    -- mowing, not sink-scrubbing
  -- When it is first due, for a chore you have never logged. Adding a chore you
  -- did last Sunday means setting this to next Sunday rather than inventing a
  -- completion that never got recorded.
  first_due_on   date not null default current_date,
  notes          text,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create unique index if not exists chores_slug_idx on chores (user_id, slug);

-- The log. One row per time the thing actually got done; the due date is a
-- function of the most recent one.
create table if not exists chore_completions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  chore_id   uuid not null references chores(id) on delete cascade,
  done_on    date not null default current_date,
  minutes    smallint,                              -- actual, when you bother; null = use the estimate
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists chore_completions_idx
  on chore_completions (user_id, chore_id, done_on desc);

-- The plan: this chore, that day. Written by accepting a suggested week, or by
-- dragging one thing onto one day.
create table if not exists chore_plan (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  chore_id   uuid not null references chores(id) on delete cascade,
  planned_on date not null,
  source     text not null default 'suggested',     -- 'suggested' | 'manual'
  status     text not null default 'planned',       -- 'planned' | 'done' | 'skipped'
  created_at timestamptz not null default now()
);

-- One chore lands on one day at most once. Re-suggesting a week upserts through
-- this rather than stacking duplicates.
create unique index if not exists chore_plan_unique
  on chore_plan (user_id, chore_id, planned_on);

create index if not exists chore_plan_day_idx
  on chore_plan (user_id, planned_on);

-- How much chore time each weekday can absorb, and when to be told.
-- One row, same shape as the rest of this single-user schema.
create table if not exists chore_settings (
  user_id       uuid primary key,
  -- Minutes available per weekday, Monday first. A Tuesday of 20 and a Saturday
  -- of 120 is the whole reason the suggester produces a plan you'd actually do.
  day_minutes   smallint[] not null default '{20,20,20,20,20,120,60}',
  notify_hour   smallint not null default 7,        -- local hour the daily push aims for
  timezone      text not null default 'Europe/London',
  -- The last date a digest went out, in the user's own timezone. The cron runs
  -- on a fixed UTC schedule and this is what keeps one notification a day one
  -- notification a day, whatever the schedule and the clocks are doing.
  last_digest_on date,
  updated_at    timestamptz not null default now(),
  constraint day_minutes_length check (array_length(day_minutes, 1) = 7)
);

-- Web push endpoints. One per installed browser; a phone and a laptop are two rows.
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  label      text,                                  -- 'Pixel 8' etc., set by hand if it helps
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  -- Set when the push service returns 404/410. Kept rather than deleted so a
  -- silent phone has a visible reason on the settings screen.
  expired_at timestamptz
);

create unique index if not exists push_subscriptions_endpoint_idx
  on push_subscriptions (endpoint);

-- Every chore with its due date resolved. The one piece of due logic, kept in
-- the database so the app, the cron job and any script agree by construction.
create or replace view chore_status as
select
  c.id,
  c.user_id,
  c.slug,
  c.name,
  c.area,
  c.interval_days,
  c.effort_minutes,
  c.prefer_weekend,
  c.notes,
  c.sort_order,
  last.done_on as last_done_on,
  coalesce(last.done_on + c.interval_days, c.first_due_on) as due_on,
  (current_date - coalesce(last.done_on + c.interval_days, c.first_due_on)) as days_overdue
from chores c
left join lateral (
  select done_on from chore_completions cc
  where cc.chore_id = c.id
  order by cc.done_on desc
  limit 1
) last on true
where c.archived_at is null;
