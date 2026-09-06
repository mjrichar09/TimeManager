-- Repair a timezone that isn't one.
--
-- 0007 only rewrote rows still holding the old default, and by then the value
-- had been hand-typed into what was a free-text field as 'United States/New
-- York'. That is not an IANA zone, so Intl.DateTimeFormat threw a RangeError
-- inside todayIn() — which every Rounds page calls — and the whole app returned
-- 500s until this ran.
--
-- The field is a dropdown now, and both saveSettings() and todayIn() refuse to
-- trust the column. This just fixes the row that is already wrong.

update chore_settings
set timezone = 'America/New_York', updated_at = now()
where timezone !~ '^[A-Za-z_]+/[A-Za-z_+-]+$' or timezone = 'United States/New York';
