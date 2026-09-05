import { deflateSync } from 'node:zlib'

/**
 * A minimal PNG encoder — enough to write the PWA icons and no more.
 *
 * Written by hand rather than pulled from an image library because the icons are
 * a few rectangles and an arc, and this keeps a build dependency out of the tree.
 * Shared by scripts/icons.ts (Tally) and scripts/rounds-icons.ts (Rounds).
 */

export function crc32(buf: Buffer): number {
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

export function encodePng(size: number, rgb: (x: number, y: number) => readonly [number, number, number]): Buffer {
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


/**
 * Render a glyph with 3x3 supersampling, blending between a background and a
 * foreground colour. `coverage` returns 1 inside the glyph and 0 outside, in
 * unit coordinates.
 */
export function renderGlyph(
  size: number,
  background: readonly [number, number, number],
  foreground: readonly [number, number, number],
  coverage: (u: number, v: number) => number
): Buffer {
  const samples = 3
  return encodePng(size, (x, y) => {
    let hits = 0
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const u = (x + (sx + 0.5) / samples) / size
        const v = (y + (sy + 0.5) / samples) / size
        hits += coverage(u, v)
      }
    }
    const a = hits / (samples * samples)
    if (a === 0) return background
    if (a === 1) return foreground
    return [
      Math.round(background[0] + (foreground[0] - background[0]) * a),
      Math.round(background[1] + (foreground[1] - background[1]) * a),
      Math.round(background[2] + (foreground[2] - background[2]) * a),
    ] as const
  })
}
