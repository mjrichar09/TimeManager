-- Renewals join the weekly plan, once they are inside their lead window.
--
-- A renewal in its lead window stops being a date to know about and becomes a
-- twenty-minute errand — which is exactly what the planner already places. The
-- suggester never cared what it was placing: it needs an id, a size in minutes
-- and a date it must land on or before, and a renewal has all three.
--
-- So `chore_plan` gains a second possible subject rather than growing a twin
-- table. One plan table means one "what is on Tuesday" query, one capacity sum,
-- and one place to forget something rather than two.
--
-- The exactly-one check is what keeps that honest. Without it a row could name
-- both or neither, and every consumer would need its own opinion about which
-- wins.

alter table chore_plan alter column chore_id drop not null;

alter table chore_plan
  add column if not exists renewal_id uuid references renewals(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chore_plan_one_subject'
  ) then
    alter table chore_plan
      add constraint chore_plan_one_subject
      check (num_nonnulls(chore_id, renewal_id) = 1);
  end if;
end $$;

-- `chore_plan_unique` covers chore rows. It cannot cover renewal rows: their
-- chore_id is null, and Postgres treats nulls in a unique index as distinct, so
-- the same renewal could land on the same day twice. This is that index's twin.
create unique index if not exists chore_plan_renewal_unique
  on chore_plan (user_id, renewal_id, planned_on)
  where renewal_id is not null;

create index if not exists chore_plan_renewal_idx
  on chore_plan (user_id, renewal_id);

-- What the planner budgets against. Renewals are mostly a form and a queue, so
-- 30 minutes is a better default than a chore's 15 — and being wrong here costs
-- a plan you abandon by Wednesday, which is the one failure this app is for.
alter table renewals
  add column if not exists effort_minutes smallint not null default 30;
