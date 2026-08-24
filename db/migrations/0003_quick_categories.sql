-- Meals, Commute and Sleep join the quick set.
--
-- `is_quick` marks the categories that get a home-screen shortcut and sort first
-- in the capture grid. The original six were sized for the iOS Shortcuts menu,
-- where every extra item is another line to scroll past. On Android each
-- shortcut is its own icon, so a seventh costs nothing per tap — the rationing
-- that shaped the original list doesn't apply.
--
-- Sleep especially: missing that tap leaves the evening's block running until
-- morning, so it is the single highest-consequence switch of the day.

update categories
set is_quick = true
where slug in ('meals', 'commute', 'sleep');
