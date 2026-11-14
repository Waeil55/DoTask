// Generates the extension's PNG icons with no dependencies (node tools/make-icons.mjs).
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons')
mkdirSync(outDir, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size)
      const i = y * (size * 4 + 1) + 1 + x * 4
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}

// Distance from point p to segment ab
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pixel(x, y, s) {
  const u = x / s, v = y / s
  // rounded square mask
  const r = 0.22, m = 0.04
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0)
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0)
  const d = Math.hypot(qx, qy) - r
  const aa = 1.5 / s
  const alpha = Math.max(0, Math.min(1, 0.5 - d / aa))
  if (alpha <= 0) return [0, 0, 0, 0]
  // indigo -> teal diagonal gradient
  const t = (u + v) / 2
  let R = 79 + (20 - 79) * t, G = 70 + (184 - 70) * t, B = 229 + (166 - 229) * t
  // check mark
  const w = 0.075
  const cd = Math.min(segDist(u, v, 0.27, 0.52, 0.43, 0.68), segDist(u, v, 0.43, 0.68, 0.74, 0.34))
  const ca = Math.max(0, Math.min(1, 0.5 - (cd - w) / aa))
  R = R + (255 - R) * ca; G = G + (255 - G) * ca; B = B + (255 - B) * ca
  return [Math.round(R), Math.round(G), Math.round(B), Math.round(alpha * 255)]
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), png(size, pixel))
}
console.log('icons written to', outDir)
