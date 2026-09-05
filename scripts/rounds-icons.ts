import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderGlyph } from './png'

/**
 * Generates the Rounds PWA icons: a broken ring with a marker sitting in the
 * break — a position on a cycle, a thing that comes round again.
 *
 * Deliberately the inverse of Tally's icon (ink glyph on chalk, rather than
 * chalk on ink). The two apps sit next to each other on a home screen and the
 * fastest way to tell two small squares apart is which one is dark.
 *
 * Re-run with `npx tsx scripts/rounds-icons.ts`.
 */

const INK = [0x14, 0x14, 0x14] as const
const CHALK = [0xf2, 0xf2, 0xef] as const

const RADIUS = 0.27
const STROKE = 0.055

/** Where the ring breaks, in degrees, measured anticlockwise from east. */
const GAP_FROM = 52
const GAP_TO = 98

/** The marker, centred in the break. */
const MARKER_AT = (GAP_FROM + GAP_TO) / 2
const MARKER_RADIUS = 0.078

const DEG = Math.PI / 180

/** A point on the icon at `degrees` anticlockwise from east, `radius` from centre. */
function polar(degrees: number, radius: number): [number, number] {
  return [0.5 + radius * Math.cos(degrees * DEG), 0.5 - radius * Math.sin(degrees * DEG)]
}

function glyphCoverage(u: number, v: number): number {
  const dx = u - 0.5
  const dy = v - 0.5
  const r = Math.hypot(dx, dy)

  // The ring, minus the gap the arrowhead sits in.
  if (Math.abs(r - RADIUS) <= STROKE / 2) {
    // Screen y grows downwards; negate it so the angle reads anticlockwise.
    const angle = (Math.atan2(-dy, dx) / DEG + 360) % 360
    if (angle < GAP_FROM || angle > GAP_TO) return 1
  }

  // A marker sitting in the break, one step round the cycle. An arrowhead was
  // the obvious choice and the wrong one: at 48 pixels on a home screen the
  // wedge reads as a pointer into the circle rather than as travel around it,
  // whereas a dot on a broken ring reads as a position on a cycle immediately.
  const [mx, my] = polar(MARKER_AT, RADIUS)
  if (Math.hypot(u - mx, v - my) <= MARKER_RADIUS) return 1

  return 0
}

const outDir = join(process.cwd(), 'public', 'icons')
mkdirSync(outDir, { recursive: true })

for (const size of [180, 192, 512]) {
  const file = join(outDir, `rounds-${size}.png`)
  writeFileSync(file, renderGlyph(size, CHALK, INK, glyphCoverage))
  console.log(`  wrote public/icons/rounds-${size}.png`)
}
