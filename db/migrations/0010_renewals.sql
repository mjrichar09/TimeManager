-- Renewals — dated obligations that cannot be done early.
--
-- Car inspection, registration, insurance, Global Entry, passport, licence.
-- These look like chores and are the opposite of chores in the one way that
-- matters, so they get their own table rather than a flag on `chores`.
--
-- A chore's due date is DERIVED: `chore_status` computes last completion plus
-- the interval, which is why doing one early shifts everything after it with no
-- reconciliation step. A renewal's due date is IMPOSED — the state prints it on
-- the document — and renewing early does NOT move it. Renew a registration
-- three months early and the new expiry is still the old expiry plus a year.
-- So `due_on` is stored, and the next cycle anchors on the due date rather than
-- on `completed_on`. Putting that behaviour behind the same table as chores
-- would mean a boolean that changes what every other column means.
--
-- It also means no status view. `chore_status` exists because due-ness is a
-- computation that the app, the cron and any script must agree on; here it is a
-- column, and there is nothing to disagree about.

create table if not exists renewals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  slug           text not null,
  name           text not null,
  -- Free text, same idea as chores.area: 'vehicle' | 'identity' | 'insurance' | 'home'.
  category       text,
  -- The date it expires. Authoritative, and edited by hand when a renewal
  -- arrives with a date you didn't predict — which is most of them.
  due_on         date not null,
  -- How long a cycle runs, in months. Passport 120, Global Entry 60, licence
  -- 48-96, inspection and registration 12, insurance 6 or 12. Null for the ones
  -- that are genuinely irregular: renewing then just asks for the new date.
  period_months  smallint,
  -- How far ahead to start saying something. The whole point of the section:
  -- a passport is useless to know about on the day it expires. Per-item because
  -- a month is right for an inspection and nowhere near enough for a passport.
  lead_days      smallint not null default 30,
  notes          text,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  archived_at    timestamptz,

  -- Alert bookkeeping. Which due date and which stage were last announced, so
  -- an alert fires on entering a stage rather than every morning for 90 days.
  -- Scoped to the due date so renewing something resets it by construction.
  alert_due_on   date,
  alert_stage    text,
  alerted_on     date,

  constraint renewals_lead_sane check (lead_days between 1 and 730),
  constraint renewals_period_sane check (period_months is null or period_months between 1 and 240)
);

create unique index if not exists renewals_slug_idx on renewals (user_id, slug);
create index if not exists renewals_due_idx on renewals (user_id, due_on);

-- The log. One row per time it was actually renewed, keeping both the date it
-- replaced and the date it moved to — so a history of "when did this last get
-- done, and what did it become" survives any later hand-editing of due_on.
create table if not exists renewal_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  renewal_id      uuid not null references renewals(id) on delete cascade,
  completed_on    date not null default current_date,
  previous_due_on date not null,
  new_due_on      date not null,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists renewal_events_idx
  on renewal_events (user_id, renewal_id, completed_on desc);
