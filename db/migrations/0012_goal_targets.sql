-- Goals gain a lead measure, a time target, and dated milestones.
--
-- The 2026-09-10 decision stands: hours are not progress, and nothing here
-- derives a goal's progress from the block log. What changes is that a goal now
-- carries the *system* that is supposed to move it — 4DX's lead measure, with
-- Atomic Habits' implementation intention (when, where, how long) and its
-- two-minute fallback, and WOOP's named obstacle.
--
-- Progress is ENTERED BY HAND, one number per period. That is a deliberate
-- choice and the opposite of `chore_status`, where due-ness is derived because
-- the app, the cron and the scripts all have to agree on it. Here there is
-- nothing to agree on: whether Sunday's conversation actually happened is a
-- judgement only the person who had it can make, and no column in `blocks`
-- knows it. A tap-to-log tracker would be a third capture habit competing with
-- the one habit the baseline is supposed to be building.

alter table goals add column if not exists lead_measure    text;
alter table goals add column if not exists target_count    smallint;
alter table goals add column if not exists target_period   text not null default 'week';
alter table goals add column if not exists session_minutes smallint;
alter table goals add column if not exists two_minute      text;
alter table goals add column if not exists obstacle        text;

-- `add constraint if not exists` doesn't exist, and re-running a migration file
-- by hand shouldn't fail on the second pass.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_target_period_ck') then
    alter table goals add constraint goals_target_period_ck
      check (target_period in ('week', 'month'));
  end if;
end $$;

-- One row per goal per period, written by hand from the goals screen.
--
-- Keyed on the period start rather than carrying a running total, so the
-- history is readable: four rows of 3, 3, 0, 1 says something a single "12"
-- never could, and "never miss twice" is a question you can only ask of a
-- sequence.
--
-- `period_start` is a Monday for a weekly goal and the 1st for a monthly one,
-- computed in the BROWSER's timezone and sent with the write — the same
-- convention as reconcile's day window, and for the same reason: the server
-- cannot know which week the person looking at the screen is in.
create table if not exists goal_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  goal_id      uuid not null references goals(id) on delete cascade,
  period_start date not null,
  done_count   smallint not null default 0,
  note         text,
  updated_at   timestamptz not null default now(),
  constraint goal_progress_count_ck check (done_count >= 0 and done_count <= 99)
);

create unique index if not exists goal_progress_unique
  on goal_progress (user_id, goal_id, period_start);

-- Milestones: the sub-goals, flat and optionally dated.
--
-- Flat rather than hung off `goals.parent_id`, which stays reserved for the
-- cascade. A milestone is not a smaller goal — it has no rank, no lead measure
-- and no weekly rhythm. It is one dated thing that either happened or didn't,
-- and its job is to give the long goals an intermediate reading: D's real test
-- is twelve months out, which is far too long a feedback loop to steer by.
--
-- `done_on` is a date, not a boolean, because when a milestone landed is worth
-- more later than the fact that it did.
create table if not exists goal_milestones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  goal_id    uuid not null references goals(id) on delete cascade,
  title      text not null,
  due_on     date,
  done_on    date,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists goal_milestones_idx
  on goal_milestones (user_id, goal_id, sort_order, created_at);
