-- Rounds runs on New York time.
--
-- The timezone is not cosmetic. `todayIn()` derives "today" from it, and every
-- due date, overdue count and planned day is measured against that — so a wrong
-- zone doesn't look wrong, it just quietly shifts the whole app by a day near
-- midnight.
--
-- It also sets what the cron has to do. The daily job fires on a fixed UTC
-- schedule and only sends once the *local* hour has reached notify_hour, so the
-- schedule in vercel.json has to clear 07:00 in New York in winter, when the
-- offset is at its largest (UTC-5). That is 12:00 UTC. See docs/rounds.md.

alter table chore_settings alter column timezone set default 'America/New_York';

update chore_settings
set timezone = 'America/New_York', updated_at = now()
where timezone = 'Europe/London';
