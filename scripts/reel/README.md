# Demo reel

Scripts that record and assemble the Tally & Rounds demo reel: a 16:9 master
for X and Reddit and a 1:1 cut, with captions burned in. Every take is scripted,
so the reel can be re-shot after a UI change without redoing it by hand.

Outputs go to `.reel/` at the repo root (git-ignored). The videos show real data,
so they stay out of git.

## What it needs

- **A Neon branch.** The phone takes write: they tap categories, drag a block's
  edge, split and relabel it, finish a chore and save a plan. Never point the dev
  server at the live database for this.
- **Playwright with Chromium.** From the project if installed, else the global
  install.
- **ffmpeg.** `$FFMPEG`, else `ffmpeg-static` if installed
  (`npm i --no-save ffmpeg-static`), else `ffmpeg` on the PATH.
- **The baseline explorer page** for the explorer scene. It isn't in the repo
  because it embeds export data. Put it at `.reel/tally-explorer.html` or pass
  its path.

## Shooting

```sh
# 1. Dev server against the branch. NODE_USE_ENV_PROXY=1 only matters behind a
#    proxy, where next/font otherwise can't download Plex.
DATABASE_URL="<branch url>" SESSION_SECRET="<32+ chars>" TALLY_PASSWORD=reel \
  NODE_USE_ENV_PROXY=1 npx next dev -p 3100

# 2. Fonts, and the explorer page with goals removed.
node scripts/reel/prepare-explorer.cjs path/to/tally-explorer.html

# 3. The takes. Pass scene names to re-shoot only some.
REEL_PASSWORD=reel node scripts/reel/record.cjs
REEL_PASSWORD=reel node scripts/reel/record.cjs plan,explorer

# 4. Both cuts, into .reel/out/.
node scripts/reel/compose.cjs
```

| Variable | Default | |
|---|---|---|
| `REEL_PASSWORD` | `$TALLY_PASSWORD` | The dev server's password |
| `REEL_BASE` | `http://localhost:3100` | The dev server |
| `REEL_PLAN_WEEK` | next Monday | The week the Plan scene clears and re-suggests |
| `REEL_DIR` | `.reel/` | Where everything is written |
| `FFMPEG` | ffmpeg-static, then `ffmpeg` | ffmpeg binary |

## How it works

- **record.cjs** drives each scene in its own browser context:
  - capture, reconcile, explorer;
  - plan, today, renewals.

  Frames come from a loop of full-resolution screenshots. Playwright's own video
  recorder and Chrome's screencast both capture at 1x under device emulation.
  The phone is shot at 1.25x, which keeps the loop near 20 fps.

  Scenes pick their targets from what's on screen (the key that isn't open, the
  longest recent block, the first chore with a timer), because earlier takes
  change the data. A tap ripple is drawn on the phone and a cursor on desktop,
  and Next's dev badge is hidden.
- **prepare-explorer.cjs** inlines IBM Plex as data URIs, so nothing depends on
  reaching Google Fonts at render time. It also strips the Goals section.
- **compose.cjs** renders the title and chapter cards, the phone and browser
  frames and the captions as HTML in Plex, then uses ffmpeg to:
  - drop each take into its frame;
  - hold the first and last frame so captions can be read;
  - join the scenes with short crossfades.

  The sequence, captions and playback speeds are the `SEQUENCE` list at the top.

## Known quirks

- **Chore estimates.** The Today scene times a chore for a few seconds, which
  rewrites that chore's estimate on the branch. Restore estimates before
  re-shooting Plan, or the plan shows "1m" chores.
- **Saved plans.** If the Plan week already has a saved plan, the scene clears it
  on screen before suggesting. Clearing the branch's `chore_plan` rows for that
  week first gives a cleaner take.
