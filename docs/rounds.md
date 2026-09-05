# Rounds

Periodic chores, planned rather than remembered. Deep clean the sink, clean the
drying racks, mow the lawn — things that come round on a cycle, where the cost
isn't the doing, it's holding the list in your head.

Rounds lives in the same repo, the same Vercel project and the same database as
Tally, and shares its login. What makes it a separate *app* is `/rounds`: its own
manifest, its own icon and its own scope, so it installs to the home screen as a
second thing you open.

## The idea

Three moving parts, and the third is the point:

1. **A list with intervals.** Every chore is a name and "every N days".
2. **A due date derived from the log.** Nothing stores "next due"; it is always
   the last completion plus the interval. Do a chore early and everything after
   it shifts, with no reconciliation step.
3. **A planned week.** Each day has a capacity in minutes. The suggester places
   what comes due into the days that have room for it, on or before the due date
   where it can. You move whatever you disagree with and save.

Once the week is planned, the morning notification reads it back to you. There
is nothing left to decide at 8am, which is the whole exercise.

## Screens

| Route | What it is for |
|---|---|
| `/rounds` | Today's list. Tap a row to mark it done. Overdue-and-unplanned shows separately, because that list is the one worth keeping short. |
| `/rounds/plan` | The week. Opens on a suggestion; nothing is written until you press save. `?week=YYYY-MM-DD` shows any other week. |
| `/rounds/chores` | The list itself — intervals, effort estimates, areas. |
| `/rounds/settings` | Day capacity, notification hour, and push subscriptions. |

## How the suggester decides

In `lib/rounds-plan.ts`, pure and covered by `npm run test:plan`:

- Only chores due on or before the end of the week are candidates.
- Most overdue first; among equally urgent ones, the longest job first, because a
  90-minute hedge-cut has far fewer days it can fit into than a 5-minute bin run.
- Each chore goes on the emptiest day that still gets it done **on or before** its
  due date, so the week is spread rather than front-loaded. Something already
  overdue goes on the earliest day with room instead — it is late already.
- A weekend preference is a preference: the lawn waits for Saturday only if
  Saturday is still on time.
- Days that have already gone take nothing.
- Anything that doesn't fit is **reported, not crammed in**. The screen tells you
  how many minutes over the week is, and you decide: raise a day's capacity, put
  it in anyway, or let it run late on purpose.

Day capacity is the number that makes or breaks this. Be pessimistic — a Tuesday
that claims an hour and gets twenty minutes produces a plan you abandon by
Wednesday.

## Setup

### 1. Database

```bash
npm run db:migrate       # applies db/migrations/0006_rounds.sql
npm run db:seed-rounds   # 21 starter chores, first due dates staggered
```

The seed is idempotent and skips anything already there.

### 2. Push notifications

Generate a VAPID key pair once:

```bash
npx web-push generate-vapid-keys
```

Set four environment variables, locally and on Vercel:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=…   # compiled into the client bundle
VAPID_PRIVATE_KEY=…              # signs; treat as a password
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=…                    # node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

Then, on the phone:

1. Open `/rounds` in Chrome and **Add to Home screen**. Do this *first* — a
   subscription made in a browser tab is a different, more forgettable thing than
   one made in the installed app.
2. Open the installed app → **Settings** → **Subscribe this device**.
3. Press **Send today's notification now**. If nothing arrives, nothing is set up,
   and finding that out now beats finding it out at 7am on Saturday.

Subscribe on each device you want it on; a phone and a laptop are two rows in
`push_subscriptions`. An endpoint the push service retires is marked expired
rather than deleted, so a phone that has gone quiet shows a reason on the
settings screen rather than silently vanishing.

### 3. The cron

`vercel.json` runs `/api/cron/rounds` hourly. The route does the deciding:

- it sends only once the local hour has reached your notify hour, and
- `chore_settings.last_digest_on` guarantees exactly one digest per local day.

This is deliberate. Vercel crons fire on a fixed UTC schedule and the hour you
want to be told is a local one that moves twice a year, so the schedule is coarse
and the logic lives in code that knows your timezone.

**On the Hobby plan, cron jobs may run at most once a day** and are only
scheduled to within an hour. If the deploy rejects the hourly schedule, change it
to a daily one at roughly the right UTC hour:

```json
{ "path": "/api/cron/rounds", "schedule": "0 6 * * *" }
```

Everything else keeps working — you just lose the retry if the one run of the day
fails.

To check it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/rounds
```

| Response | Meaning |
|---|---|
| `{"sent":1,…}` | Delivered |
| `{"skipped":"too_early"}` | Local hour is before your notify hour |
| `{"skipped":"already_sent_today"}` | Today's digest already went out |
| `{"sent":0,"reason":"nothing_to_say"}` | Nothing planned, nothing due |
| `401 unauthorized` | `CRON_SECRET` missing or wrong |

## Schema

`db/migrations/0006_rounds.sql`. Five tables and a view, none of them referencing
Tally's — either app could be lifted out without dragging the other with it.

- `chores` — name, area, interval, effort estimate, weekend preference.
- `chore_completions` — the log. One row per time it actually got done.
- `chore_plan` — chore, day, and `planned` / `done` / `skipped`.
- `chore_settings` — day capacities, notify hour, timezone, last digest sent.
- `push_subscriptions` — one row per installed browser.
- `chore_status` (view) — every chore with its due date resolved. The single
  piece of due logic, kept in the database so the app, the cron job and any
  script agree by construction.

## Things worth knowing

**The service worker is at `/sw.js` and claims scope `/`.** A worker may only
claim a scope its own URL covers, and the file has to sit at the root for that,
which means it also controls Tally's pages. Harmless: it has no `fetch` handler
and does nothing but listen for pushes.

**Intervals are guesses, and the app assumes they are wrong.** Change them from
the chores screen once you have seen a chore come round twice. One you keep
skipping is too short; one that always arrives after you have already noticed the
mess is too long.

**Marking something done writes a completion, not a plan update.** That is what
moves the due date. Closing the plan row is bookkeeping, and an early completion
clears the chore off a later day in the same week.
