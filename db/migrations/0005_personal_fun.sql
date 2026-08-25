-- Personal fun: leisure you chose, as distinct from leisure that happened to you.
--
-- Media / scroll already catches the evening hour that disappears. What it can't
-- catch is the hour you deliberately spent on a book, a game, a film — because
-- once both land in the same bucket, a week of reading and a week of doomscrolling
-- report identically, and the one number you'd act on is the one you can't see.
-- Two activities belong in one category only if you'd decide the same way about
-- both; here you'd decide the opposite way, so they split.
--
-- Not Personal projects: that one is fun with an output, and its pull is that the
-- output accumulates. This is fun with nothing to show afterwards, which is
-- exactly the kind that gets squeezed out first and never shows up as a loss.
--
-- is_quick because the whole value of the split is captured at tap time. If Media
-- / scroll is one tap on the home screen and this is four taps through the app,
-- the evening gets logged as scrolling regardless of what actually happened — the
-- distinction would exist only in the schema.
--
-- energy stays 0 (unrated) per 0004, even though this one looks obviously
-- positive. The interesting question is whether it actually charges you or just
-- feels like it should, and pre-rating it is how you'd stop yourself from finding
-- out. buyback_cost is null: nobody can have your fun for you.

insert into categories (user_id, slug, name, energy, value_tier, buyback_cost, is_quick, sort_order)
select user_id, 'personal-fun', 'Personal fun', 0, 2, null, true, 16
from categories
where slug = 'media-scroll'
on conflict (user_id, slug) do nothing;
