import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Generates the PWA icons: a tally mark — four strokes and the fifth struck
 * through — on the app's ink background.
 *
 * Written by hand rather than pulled from an image library because it's a few
 * rectangles and this keeps a build dependency out of the tree. Re-run with
 * `npx tsx scripts/icons.ts` if the palette ever changes.
 */

const INK = [0x14, 0x14, 0x14] as const
const CHALK = [0xf2, 0xf2, 0xef] as const

function crc32(buf: Buffer): number {
  let table = crc32.table
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    crc32.table = table
  }
  let crc = -1
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]
  return (crc ^ -1) >>> 0
}
crc32.table = undefined as Int32Array | undefined

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size: number, rgb: (x: number, y: number) => readonly [number, number, number]): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = rgb(x, y)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
      raw[p++] = 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

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
  const samples = 3
  return encodePng(size, (x, y) => {
    let hits = 0
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const u = (x + (sx + 0.5) / samples) / size
        const v = (y + (sy + 0.5) / samples) / size
        hits += glyphCoverage(u, v)
      }
    }
    const a = hits / (samples * samples)
    if (a === 0) return INK
    if (a === 1) return CHALK
    return [
      Math.round(INK[0] + (CHALK[0] - INK[0]) * a),
      Math.round(INK[1] + (CHALK[1] - INK[1]) * a),
      Math.round(INK[2] + (CHALK[2] - INK[2]) * a),
    ] as const
  })
}

const outDir = join(process.cwd(), 'public', 'icons')
mkdirSync(outDir, { recursive: true })

for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, render(size))
  console.log(`  wrote public/icons/icon-${size}.png`)
}
