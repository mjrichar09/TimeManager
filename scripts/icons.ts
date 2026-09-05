import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderGlyph } from './png'

/**
 * Generates the PWA icons: a tally mark — four strokes and the fifth struck
 * through — on the app's ink background.
 *
 * Re-run with `npx tsx scripts/icons.ts` if the palette ever changes. The PNG
 * encoder itself lives in scripts/png.ts, shared with Rounds' icons.
 */

const INK = [0x14, 0x14, 0x14] as const
const CHALK = [0xf2, 0xf2, 0xef] as const

/** Coverage of the tally glyph at a point, in unit coordinates. */
function glyphCoverage(u: number, v: number): number {
  const margin = 0.26
  const top = margin
  const bottom = 1 - margin
  const left = margin
  const right = 1 - margin

  // Four uprights.
  const strokeWidth = 0.052
  const gap = (right - left - strokeWidth) / 3
  for (let i = 0; i < 4; i++) {
    const cx = left + i * gap
    if (u >= cx && u <= cx + strokeWidth && v >= top && v <= bottom) return 1
  }

  // The fifth, struck diagonally across the other four.
  const x1 = left - 0.03
  const y1 = bottom + 0.02
  const x2 = right + 0.01
  const y2 = top - 0.02
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)))
  const distance = Math.hypot(u - (x1 + t * dx), v - (y1 + t * dy))
  return distance <= strokeWidth / 2 ? 1 : 0
}

function render(size: number): Buffer {
  return renderGlyph(size, INK, CHALK, glyphCoverage)
}

const outDir = join(process.cwd(), 'public', 'icons')
mkdirSync(outDir, { recursive: true })

for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, render(size))
  console.log(`  wrote public/icons/icon-${size}.png`)
}
