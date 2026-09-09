# Goals — working record

Started 2026-08-24. Updated 2026-09-09. **Not yet entered in the app.**
Stopped at step 7 of 7.

To resume: read this file, then do step 7 — map categories to goals and enter
all five in the app. Do it before the week-4 report lands (~2026-09-20), or the
allocation report has no goals to allocate against.

---

## Where the build is

M0–M3 shipped and live at https://tally-five-psi.vercel.app

Capture, reconcile, daily check, goals screen, the switch endpoint, and the
Android shortcuts all work. Logging started 2026-08-23. M4 (reports) waits until
the end of baseline week 4 — roughly 2026-09-20 — per build-plan §8.

One outstanding data repair: 2026-08-23 has a 19-hour "Social / family" block
from filling a whole gap before partial fill and split existed. Fixable in
reconcile.

---

## The literature this is built on

The build plan never cites anyone, but its vocabulary maps onto:

- **The Buyback Principle** (Martell) — DRIP quadrant, `buyback_cost`, audit before delegation
- **Statistical process control / DOE** — baseline before intervention, run charts, one or two changes at a time
- **4DX** — ranked wildly-important goals, lead vs lag measures, the daily `moved_priority` scoreboard
- **4-Hour Workweek** (Ferriss) — dreamlines priced monthly, fear-setting, 80/20, and *eliminate before automate before delegate*
- **Atomic Habits** (Clear) — systems over goals, identity, implementation intentions, two-minute rule, never miss twice
- **Essentialism** (McKeown) — clear yes or clear no
- **WOOP** (Oettingen) — name the obstacle in advance
- **Deep Work** (Newport) — already present as a seed category

### Three tensions worth remembering

1. **Clear vs. goal-setting.** "You don't rise to the level of your goals, you fall to the level of your systems." Resolution: the goal is the direction, the lead measure is the system, and Tally measures the system — hours — not the goal.
2. **Ferriss vs. Martell on drains.** Martell says buy it back; Ferriss says eliminate first. Ferriss is right on ordering. In week 4, ask *"should this exist?"* before *"who should do this?"*
3. **Clear vs. the baseline protocol.** Atomic Habits says start now; the plan says change nothing for four weeks. The capture habit is the one habit to build now. Everything else waits.

---

## The process

1. Raw material ✅
2. Draft candidates ✅
3. Quality tests ✅
4. Forced rank ✅
5. Lead measures — 4 of 5 done
6. Name the displacement ✅
7. **Map categories → goals, enter in the app ← we are here**

---

## Settled

**The job is a fixed cost.** Not a goal. Expect a large block of hours against no
goal in week 4 — that's expected, not a finding. The one lever named was more
working from home, which is really *commute elimination*; Tally will price it.

**House purchase is decoupled from the household drains.** Pests, yard and
cleaning are independent of moving, and a new house imports them. The
reorganisation needs doing regardless.

**Career goal dropped**, and for the right reason — internal promotion isn't in
his control, which fails the test. It became a decision rule instead:

> **If no promotion by January, start looking for an AD role elsewhere.**

Park as a January quarterly-review trigger. Costs no attention until then.

---

## The five goals

Ranked. B and C kept separate by choice.

| Rank | Goal | Notes |
|---|---|---|
| 1 | **B** — Disagreements end with a decision both of us understand | Failure modes: unresolved, capitulation, escalation |
| 2 | **A** — AllSquare earning $100/mo by January | ~11 subscribers at $9/mo |
| 3 | **C** — Division of labour agreed, and bought back where it's cheap | Enables the whole week-4 DRIP plan |
| 4 | **D** — Still carrying L pain-free in 12 months | Prehab, not volume |
| 5 | **E** — House reorganised | Invest: pays down a recurring drain |

### The dependency chain

**B** makes **C** possible → **C** frees the hours that **A**, **D** and **E**
need. The top-ranked goal is the constraint, the third-ranked is the funding
source. C isn't competing with A/D/E; it's paying for them.

### Rank notes

- **D at rank 4 is safe.** Rank decides what wins when goals contend; D draws
  from early mornings, a pool nothing else wants. 45 min/week. — *Disputed
  2026-09-09: A's lead measure claims the same mornings. See "Open — goal D".*
- **E at rank 5 won't happen** unless time-boxed. Pending over a year already.
  One named zone per month, zones listed up front.

---

## Lead measures

**B** — *"Sunday 8pm, kids down, 30 minutes at the kitchen table, phones in the
other room. One agenda: what needs deciding this week. Decisions written down."*

Escalation happens in the moment, so the fix is moving decisions to a scheduled
calm slot, not better in-the-moment behaviour. Needs an agreed in-the-moment
phrase — *"can we put that on Sunday?"* — and it needs his wife's buy-in, which
is itself the first conversation. Can't be implemented unilaterally.

**A** — *"3 beta prospects contacted per week. Tuesday and Thursday, 30 minutes,
first thing. At least one per week from a channel that could scale."*
Two-minute version: one message.

**C** — pending. Likely an output of B's weekly meeting; milestone is having the
buy-back conversation when the DRIP data lands in week 4.

**D** — *"3×/week, 15 minutes, before anyone's up: hip mobility and posterior
chain."* Two-minute version: five minutes of hip work. Never miss twice.

**E** — *"Saturday 9–11, one zone."* Zones to be named.

---

## AllSquare

Real estate app: compare a shortlist of houses, renovation estimates, all-in cost
estimation, personalised scoring. **$9/mo.** Working version exists; next step per
his own plan is a beta, then the paid release.

| Target | Subscribers |
|---|---|
| $100/mo by January | ~11 |
| $1,000/mo by June | ~111 |

**The user stops being a user on success.** Someone comparing a shortlist is done
in 2–4 months — they buy, they cancel. The base is a flow, not a stock. At a
3-month average lifetime, holding 111 concurrent means adding **~37/month, about
nine a week, indefinitely.** June is an acquisition problem, not a product one.

So the beta must test a **channel**, not just the product. Realtors and mortgage
brokers are the obvious candidate — one realtor sits on a stream of buyers, which
is the only source that scales to that number. Recruiting only from friends ends
with good feedback and no channel.

**Counting backwards from January:** recruit 3–4 wks, run beta 4–6, act and ship
4–6, first customers 4–8 = 15–24 weeks. Written 2026-08-24, when January was
~22 weeks out. As of 2026-09-09 it is **~20.6 weeks** and recruitment still has
not started — at the pessimistic end of the estimate the slack is now gone. The
whole chain gates on the cheapest step, and every week it slips, January slips
with it.

**He is his own user.** Building a house-comparison app while house-hunting means
dogfooding on his own shortlist, and open houses are populated by people with
exactly the user's problem. The house-purchase goal and AllSquare stopped
competing — same hours serve both.

---

## Displacement — settled 2026-09-09

Three named, as candidates from his own answers:

1. **Media / scroll**
2. **Yard work and cleaning** — if C buys them back
3. **Commute** — if the working-from-home lever gets pushed

**Only the first is unilateral.** Two and three are downstream of conversations
that haven't happened, which makes them a plan rather than a subtraction. If
week 4 shows the arithmetic still doesn't balance, the missing hours have to
come from somewhere he controls alone. Expect the tracking data to suggest more
candidates — that was the explicit reason for not forcing a longer list now.

---

## Open — goal D and the doctor

Seeing a doctor about the carrying pain. In progress as of 2026-09-09. What it
changes about D:

- **The lead measure is a hypothesis, and a diagnosis tests it.** Hip mobility
  and posterior chain was designed without a diagnosis. If a prescription
  arrives, it wins outright — don't run both routines, or which one worked is
  unknowable. Watch for a generic "stretch more", which leaves the hypothesis
  untested while feeling like progress.
- **The target moves.** L gets heavier over the twelve months, so the test in
  September 2027 is harder than today's. Maintaining capacity may not be enough.
  Ask directly whether progressive loading is indicated — "prehab, not volume"
  was an assumption, not an answer.
- **Twelve months is too long a feedback loop.** Every other goal has a weekly
  signal; D has one reading, a year out. Needs an intermediate measure — pain
  frequency, or a repeatable carry test — or a wrong approach only surfaces
  when it's too late to change.
- **The constraint is calendar, not hours.** GP → imaging → physio is weeks of
  waiting. D fails on a booking not made, not on a morning not used.
- **"Never miss twice" needs an exception.** That rule is about motivation. A
  missed session here may be a symptom, not a lapse, and the rule as written
  pushes through a flare. State the distinction.

### Two links the ranking missed

- **D should inform C's priorities.** When the DRIP data lands, drains that load
  the injury are expensive in D as well as in dollars — a tiebreaker for what to
  buy back first. E is lifting work and cuts the same way.
- **A and D compete for the same morning.** A is "Tuesday and Thursday, 30
  minutes, first thing"; D is "3×/week, 15 minutes, before anyone's up". D's
  rank-4 safety argument says early mornings are "a pool nothing else wants" —
  but A wants it. On Tue/Thu that's 45 minutes before anyone's up, not 15.
  Either stagger the days or drop the claim that the pool is uncontested.

---

## Open — goal B

The Sunday-evening conversation has not happened yet. Intended "soon" as of
2026-09-09. It is the top-ranked goal, the one thing that can't be implemented
unilaterally, and C's lead measure is downstream of it — so it gates the
displacement plan above, not just B.
