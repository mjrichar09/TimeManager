-- Personal care: showering, teeth, getting dressed, the rest of it.
--
-- This is the category the day loses without noticing. Each instance is ten or
-- twenty minutes, several times a day, at exactly the moments you are least
-- likely to be holding a phone — so untracked it doesn't show up as a category
-- with a small number next to it, it shows up as morning and evening gaps on
-- the reconcile strip that you then have to reconstruct from memory. Naming it
-- turns "45 minutes I can't account for" into one tap.
--
-- Not Household chores: that one is work on the house and has a market price
-- you could pay someone. This is work on yourself and has none — the category
-- is the unit of decision, and there is no decision to make about showering.
-- Not Meals either, which is the other daily-maintenance block, because the
-- interesting question about meals is cooking-versus-eating and there is no
-- equivalent split here.
--
-- is_quick because the whole value is captured at tap time (0003, 0005): if
-- Sleep is one tap on the home screen and this is four taps through the app,
-- the twenty minutes between waking and leaving stays a gap forever.
--
-- energy stays 0 — unrated, per 0004. It plausibly charges you and plausibly
-- drains you depending on the morning, which is exactly the sort of guess that
-- should wait for a month of data. buyback_cost is null: it can't be bought.

insert into categories (user_id, slug, name, energy, value_tier, buyback_cost, is_quick, sort_order)
select user_id, 'personal-care', 'Personal care', 0, 1, null, true, 17
from categories
where slug = 'sleep'
on conflict (user_id, slug) do nothing;
