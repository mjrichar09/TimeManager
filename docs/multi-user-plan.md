# Tally & Rounds for more than one person

Tally and Rounds are built for one person. One password opens them, one user id
comes from an environment variable, and the categories, chores and goals were
written into migrations and seed scripts. This plan covers turning that into
something other households can sign up for, in a separate public repository.

The apps themselves don't change: Tally helps you see where your time goes so
you can focus on what matters and cut or hand off the rest, and Rounds plans
chores and renewals into the time you have so they stop living in your head.
What changes is who they can belong to.

---

## Decisions already made

### Data lives on a server, in Postgres

Keep Neon. On-device storage was considered and rejected, because two of the
features that make these apps worth using need a server:

- **Shortcut buttons** send a request while the app is closed. If the data only
  lived on the phone, nothing would be there to receive the tap.
- **The morning notification** reads back today's plan. That is a scheduled
  server job, so the plan has to be on the server.

People also capture on a phone and review on a desktop, which needs shared data.

A small on-device queue for taps made while offline can come later. It doesn't
change this decision.

### A fresh public repository, not a GitHub fork

A fork carries the whole git history. Every commit since 2026-08-23 contains
personal material: goals, the review, chores, category choices and notes in
commit messages. Deleting files in the fork leaves them readable in history.

Instead:

1. Make the scrubbed tree in a branch here (Phase 0).
2. Copy that tree into a new repository with a single initial commit.
3. Keep this repository private as the personal instance.

### The review screen becomes a data explorer

The review screen and the standalone explorer are both built around one
baseline: a fixed start date (`BASELINE_START = '2026-08-23'` in
`app/tally/reports/page.tsx`), three fixed baseline weeks and three named
displacements. In the public version none of that is fixed. You pick any range
and compare it against any other.

---

## Phase 0: scrub the tree

Done on a branch in this repository before anything is copied out.

**Delete outright:**

- `docs/goals.md` and `docs/review-2026-09-30.md`.
- The personal sections of `tally-build-plan.md`. Keep the protocol and
  architecture.
- `scripts/seed.ts`, `scripts/seed-goals.ts` and `scripts/seed-rounds.ts`. Their
  contents become the generic templates in Phase 2.
- One-off repair scripts written for this database:
  - `repair-overlaps.ts`, `merge-duplicate-taps.ts`, `reset-blocks.ts`;
  - `show-day.ts`, `show-settings.ts`, `verify.ts`.
- `design/*.dc.html`. Eight of the eleven contain real names, chores or goals.
  Either redraw them with sample data or drop them; the code is now the
  reference.

**Rewrite:**

- **Migrations.** Squash `db/migrations/0001`–`0012` into one schema migration
  with no inserted rows. Today 0003, 0004, 0005 and 0009 insert categories for
  one user, and 0007 sets one timezone.
- **Tests.** Change `scripts/test-goals.ts` and `scripts/test-split.ts` to use
  invented fixtures.
- **Docs.** Change `docs/capture-setup.md` to a generic setup guide with no
  slugs tied to one household.
- **Copy.** Review-screen copy written about one person ("he said he'd cut…")
  becomes neutral.
- **README.** Says what the apps are for and how to run them.

**Check before copying out:** run `grep -ril` for names, places, vehicles and
employers across the tree. Read every remaining doc by eye.

---

## Phase 1: accounts and per-person data

The foundations are good. Every table already has a `user_id` column, and every
query goes through one function, `userId()` in `lib/db.ts`, which today returns
a fixed id from the environment.

1. **Sign-in.**
   - Replace `TALLY_PASSWORD` and the single-subject JWT in `lib/auth.ts` with
     real accounts.
   - Two routes: a library (Better Auth or Auth.js) with your own `users`
     table, or a hosted service (Clerk or Neon Auth). Pick the library if you
     want full control over the data, the service if you want less code.
   - Offer email magic links and Google sign-in, so no passwords are stored.
   - The session carries the user id.
2. **Per-request user.**
   - `userId()` becomes async and reads the signed-in user from the session.
   - Update about 50 call sites:
     - `lib/rounds.ts` (13), `lib/goals.ts` (13), `lib/edits.ts` (9);
     - `lib/renewals.ts` (8), `lib/push.ts` (3), `lib/switch.ts` (2);
     - a handful in pages.
   - The shortcut endpoint and the cron job don't have a session. They pass
     the user id explicitly; see Phases 4 and 5.
3. **A second line of defence.**
   - Turn on Postgres row-level security keyed to the current user, set per
     transaction.
   - Add an integration test: create two users, write as one, and confirm the
     other can read nothing.
   - This catches the query that forgets its `where user_id`.
4. **Login and proxy.**
   - `proxy.ts` keeps its shape and checks the new session.
   - Rate-limit sign-in.

**Done when:** two people can sign up on one deployment and neither can see the
other's data, proven by the test.

---

## Phase 2: onboarding and settings

Everything personal that is currently a migration or a seed becomes something
a new user chooses.

1. **Starter categories.** A default set, chosen with checkboxes at sign-up:
   - Sleep, Deep work, Meetings, Email / admin, Commute, Meals, Exercise;
   - Household chores, Media / scroll, Social / family, Personal time.

   Energy and value tiers start unrated, because they're personal judgements.
   The review screen already treats unrated as neutral.
2. **A category editor.** Name, energy (charge / neutral / drain), value tier,
   buy-back price, and whether it's a quick key on Capture. This is how a
   household ends up with "Kids — active".
3. **Chore and renewal templates.** A picker of common chores with suggested
   intervals and durations, generalised from the current seed lists, plus
   common renewals (car inspection, passport, licence, insurance).
4. **Time and capacity.**
   - Timezone comes from the browser at sign-up and can be changed.
   - Daily chore capacity has a sensible default and is editable, as now.
5. **Goals.** Optional, and empty by default. The scoreboard and lead measures
   work as they do today, without the five goals baked in.

**Done when:** a new account goes from sign-up to its first logged block and
first planned week in under five minutes, without touching code.

---

## Phase 3: the data explorer

The review screen (`/tally/reports`) and the standalone explorer become one
in-app explorer with no fixed window.

1. **Any range.**
   - A date-range picker with presets: last 7 days, last 4 weeks, last 3 months,
     this year, everything.
   - `getReports(from, to)` in `lib/reports.ts` already takes a window, so most
     of the work is the page and the picker.
2. **Compare against any period.**
   - Replace the fixed baseline weeks with a comparison range. It defaults to
     the previous period of the same length; you can pick another (for example,
     before and after a change you made).
   - The "against the baseline" panels become "against the comparison".
3. **Watch list instead of the three displacements.**
   - Any category can be pinned as something you're trying to cut or grow,
     with a start date.
   - Each shows its weekly trend against the comparison period, which
     generalises "did the hours I said I'd cut actually fall".
4. **Bring over the explorer's views:**
   - category detail;
   - the week-by-category heatmap with the week lens;
   - the energy run chart, with moved-priority and weekday/weekend comparisons;
   - the buy-back calculator;
   - the chores table with interval kept against interval set, and estimate
     against clocked time.
5. **Export.** Download the aggregates as JSON or CSV. This is
   `export:review` moved into the app, with the same "aggregates only, no
   notes" rule.

**Done when:** a user who signed up last week and one with a year of data both
get a useful explorer, with no hard-coded dates anywhere.

---

## Phase 4: shortcut buttons

One-tap capture from the home screen is the best part of Tally, and it can work
for everyone.

1. **Per-user keys.**
   - A `shortcut_tokens` table holding a hashed token, the user, a label,
     created and last-used times, and a revoked flag.
   - `/api/switch` looks the user up from the bearer token instead of
     `SHORTCUT_TOKEN`.
   - A settings screen creates, names and revokes keys, one per device.
2. **A setup page that does the tedious part:**
   - **Android:** download a ready-made HTTP Shortcuts import file, generated
     with the user's key, base URL and quick categories. This replaces building
     11 shortcuts by hand. I believe HTTP Shortcuts supports this; confirm
     before building the page around it.
   - **iPhone:** a shared Shortcut that asks for the key when it's installed.
   - **No extra app:** add app shortcuts to the web app's manifest. On Android
     you long-press the icon to get up to about four entries, and each can be
     pinned to the home screen. They open the app rather than showing a toast,
     but there's nothing to install.
3. **Rate-limit `/api/switch` per key.**

**Done when:** a non-technical user can set up home-screen buttons from the
setup page alone.

---

## Phase 5: notifications and the scheduled job

1. `push_subscriptions` is already keyed by user.
2. The hourly cron (`app/api/cron/rounds/route.ts`) loops over users whose local
   notification hour has just arrived and sends each their plan. Batch and
   bound it so one slow push can't stall the rest.
3. **Weekly summary (optional).** A Sunday notification with the week's hours
   by energy and the chores that ran late. It reuses the explorer queries.

---

## Phase 6: before opening it to the public

- **Privacy.** Time logs and household details are sensitive.
  - A plain-language privacy policy.
  - Encryption at rest (Neon provides this).
  - No analytics on page content.
- **Ownership.** Export everything (not only aggregates) and delete the account
  and all its rows.
- **Operations.**
  - Error monitoring (Sentry).
  - An email provider for sign-in links (Resend or Postmark).
  - Neon point-in-time recovery turned on.
  - A Neon preview branch per pull request, which is how the reel was recorded.
- **Hosting.** Vercel's free tier doesn't allow commercial use. If the app ever
  charges, move to Vercel Pro and a paid Neon plan. Per-user cost is tiny either
  way.

---

## Order and rough size

| Phase | What | Size |
|---|---|---|
| 0 | Scrub the tree, fresh repo | Small |
| 1 | Accounts and per-person data | Medium: the `userId()` refactor plus tests |
| 2 | Onboarding and settings | Medium |
| 3 | Data explorer with any range | Medium |
| 4 | Shortcut keys and setup page | Small–medium |
| 5 | Per-user notifications | Small |
| 6 | Privacy, export, operations | Small–medium |

A private beta for 5–20 people needs Phases 0–2, plus 4 and 5. Phase 3 can ship
during the beta, since a new user has little data to explore in week one.
Phase 6 gates a public launch.

## Open questions

- **Households, not just people.** Rounds is naturally shared: two adults, one
  set of chores. Supporting a shared household (one chore list, a plan per
  person, completions from either) is a bigger change than per-person accounts.
  Decide before Phase 2 whether it's in the first version. If it might be, the
  chore tables want a `household_id`.
- **Pricing.** Free, one-time or subscription. This decides the hosting plan,
  and whether accounts need billing from the start.
- **Name.** Keep "Tally & Rounds", or brand the pair as one product with two
  apps.
