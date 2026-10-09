// Settings shared by the reel scripts. Everything that differs between machines
// or between shoots comes from the environment, so the scripts themselves stay
// as they are. See scripts/reel/README.md.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

/** Where takes, build files and the finished videos go. Git-ignored. */
const DIR = path.resolve(process.env.REEL_DIR || path.join(ROOT, '.reel'))
fs.mkdirSync(DIR, { recursive: true })

/** The dev server to record. Point it at a Neon branch: the takes write. */
const BASE = process.env.REEL_BASE || 'http://localhost:3100'

/** The password the dev server was started with (TALLY_PASSWORD). */
function password() {
  const value = process.env.REEL_PASSWORD || process.env.TALLY_PASSWORD
  if (!value) throw new Error('Set REEL_PASSWORD to the TALLY_PASSWORD the dev server runs with')
  return value
}

/**
 * The Monday of the week the Plan scene clears and re-suggests. Defaults to next
 * week, which usually has no saved plan yet; a saved one is cleared on camera
 * anyway, but an unsaved week reads better.
 */
function planWeek() {
  if (process.env.REEL_PLAN_WEEK) return process.env.REEL_PLAN_WEEK
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Playwright from the project if it's installed there, else the global install. */
function playwright() {
  try {
    return require('playwright')
  } catch {
    const root = execSync('npm root -g').toString().trim()
    return require(path.join(root, 'playwright'))
  }
}

/** An ffmpeg binary: $FFMPEG, else ffmpeg-static if installed, else ffmpeg on the PATH. */
function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG
  try {
    return require('ffmpeg-static')
  } catch {
    return 'ffmpeg'
  }
}

module.exports = { ROOT, DIR, BASE, password, planWeek, addDays, playwright, ffmpeg }
