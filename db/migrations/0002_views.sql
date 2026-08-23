-- Tally — the rollup views (build-plan §3).
--
-- These are the analysis surface. The reports read them, and so does the weekly
-- export: the database does the arithmetic once, so nothing downstream — chart
-- code or an LLM reading the export — has to sum raw blocks.

-- Durations, with the open block measured to now().
create or replace view v_block_durations as
select
  b.id,
  b.user_id,
  b.category_id,
  b.goal_id,
  b.started_at,
  b.ended_at,
  b.source,
  b.note,
  (b.ended_at is null)                                              as is_open,
  coalesce(b.ended_at, now())                                       as effective_end,
  extract(epoch from (coalesce(b.ended_at, now()) - b.started_at))
    / 60.0                                                          as minutes,
  coalesce(b.energy_override, c.energy)                             as energy,
  c.value_tier,
  c.buyback_cost,
  (b.started_at at time zone 'UTC')::date                           as day
from blocks b
join categories c on c.id = b.category_id;

-- Hours + ratings per category per week.
create or replace view v_category_rollup as
select
  d.user_id,
  date_trunc('week', d.started_at)::date as week_start,
  d.category_id,
  c.slug,
  c.name,
  c.energy       as category_energy,
  c.value_tier,
  c.buyback_cost,
  count(*)                          as block_count,
  round(sum(d.minutes) / 60.0, 2)   as hours,
  round(
    case when c.buyback_cost is null then null
         else sum(d.minutes) / 60.0 * c.buyback_cost * 4.33
    end, 0)                         as est_monthly_buyback_cost
from v_block_durations d
join categories c on c.id = d.category_id
where d.is_open = false
group by 1, 2, 3, 4, 5, 6, 7, 8;

-- Hours per goal per week, against the declared rank. The gap is the point.
create or replace view v_goal_allocation as
with per_goal as (
  select
    d.user_id,
    date_trunc('week', d.started_at)::date as week_start,
    d.goal_id,
    round(sum(d.minutes) / 60.0, 2) as hours
  from v_block_durations d
  where d.is_open = false
  group by 1, 2, 3
)
select
  p.user_id,
  p.week_start,
  p.goal_id,
  g.title,
  g.priority_rank                                    as declared_rank,
  p.hours,
  rank() over (
    partition by p.user_id, p.week_start
    order by p.hours desc
  )                                                  as actual_rank
from per_goal p
left join goals g on g.id = p.goal_id
where p.goal_id is not null;
