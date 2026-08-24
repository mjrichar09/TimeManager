-- Cooking and Yard / garden split out of Household chores and Meals.
--
-- The category is the unit of decision: energy, value_tier and buyback_cost all
-- hang off it, so two activities belong together only if you would decide the
-- same way about both. Cooking has a market price and eating does not; lawn care
-- has a clearer price than any other household task, and often charges you where
-- cleaning drains you. Three different decisions, three categories.
--
-- energy is left at 0 (neutral) deliberately. The outsourcing queue only picks up
-- categories with energy < 0, so an unrated category makes no recommendation at
-- all — better than a confident wrong one. Rate them once there is a month of
-- data to rate them against.
--
-- buyback_cost values here are placeholders. They should end up being what it
-- actually costs to hire this out locally, not an hourly rate.

insert into categories (user_id, slug, name, energy, value_tier, buyback_cost, is_quick, sort_order)
select user_id, 'cooking', 'Cooking', 0, 2, 25, true, 14
from categories
where slug = 'meals'
on conflict (user_id, slug) do nothing;

insert into categories (user_id, slug, name, energy, value_tier, buyback_cost, is_quick, sort_order)
select user_id, 'yard-garden', 'Yard / garden', 0, 1, 40, false, 15
from categories
where slug = 'household-chores'
on conflict (user_id, slug) do nothing;
