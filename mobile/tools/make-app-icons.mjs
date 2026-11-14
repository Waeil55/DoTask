// Draws DoTask's app icons and splash screens for the iOS and Android projects, with no
// dependencies. Every PNG the Capacitor templates ship is redrawn at its own exact size:
//   ic_launcher.png (rounded square), ic_launcher_round.png (circle),
//   ic_launcher_foreground.png (adaptive icon, full-bleed), splash*.png, iOS AppIcon (opaque).
//   node tools/make-app-icons.mjs

import fs from 'node:fs'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- tiny PNG writer ----------
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
/** opaque=true writes RGB (App Store icons must not have an alpha channel). */
function png(w, h, pixel, opaque = false) {
  const bpp = opaque ? 3 : 4
  const raw = Buffer.alloc((w * bpp + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * bpp + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const p = pixel(x + 0.5, y + 0.5, w, h)
      const i = row + 1 + x * bpp
      raw[i] = p[0]; raw[i + 1] = p[1]; raw[i + 2] = p[2]
      if (!opaque) raw[i + 3] = p[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ])
}
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

// ---------- the DoTask mark: indigo -> teal gradient with a white check ----------
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const clamp01 = (v) => Math.max(0, Math.min(1, v))
/** colour of the mark at unit coords (u, v) in [0,1], check scaled by `k` around the centre */
function mark(u, v, aa, k = 1) {
  const t = (u + v) / 2
  let R = 79 + (20 - 79) * t, G = 70 + (184 - 70) * t, B = 229 + (166 - 229) * t
  const cu = 0.5 + (u - 0.5) / k, cv = 0.5 + (v - 0.5) / k
  const cd = Math.min(segDist(cu, cv, 0.27, 0.52, 0.43, 0.68), segDist(cu, cv, 0.43, 0.68, 0.74, 0.34))
  const ca = clamp01(0.5 - (cd - 0.075) / (aa / k))
  R += (255 - R) * ca; G += (255 - G) * ca; B += (255 - B) * ca
  return [R, G, B]
}

const shapes = {
  // full-bleed square (iOS masks it; Android adaptive foreground: check kept inside the 66% safe zone)
  full: (k) => (x, y, w) => { const aa = 1.5 / w; const [R, G, B] = mark(x / w, y / w, aa, k); return [R | 0, G | 0, B | 0, 255] },
  rounded: () => (x, y, w) => {
    const u = x / w, v = y / w, r = 0.22, m = 0.04, aa = 1.5 / w
    const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0)
    const a = clamp01(0.5 - (Math.hypot(qx, qy) - r) / aa)
    const [R, G, B] = mark(u, v, aa)
    return [R | 0, G | 0, B | 0, Math.round(a * 255)]
  },
  circle: () => (x, y, w) => {
    const u = x / w, v = y / w, aa = 1.5 / w
    const a = clamp01(0.5 - (Math.hypot(u - 0.5, v - 0.5) - 0.46) / aa)
    const [R, G, B] = mark(u, v, aa, 0.9)
    return [R | 0, G | 0, B | 0, Math.round(a * 255)]
  },
  // light background with a centred rounded icon
  splash: () => (x, y, w, h) => {
    const side = Math.min(w, h) * 0.28
    const u = (x - (w - side) / 2) / side, v = (y - (h - side) / 2) / side
    const bg = [247, 247, 251]
    if (u < 0 || u > 1 || v < 0 || v > 1) return [...bg, 255]
    const r = 0.22, m = 0.04, aa = 1.5 / side
    const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0)
    const a = clamp01(0.5 - (Math.hypot(qx, qy) - r) / aa)
    const c = mark(u, v, aa)
    return [0, 1, 2].map(i => Math.round(bg[i] + (c[i] - bg[i]) * a)).concat(255)
  }
}

const written = []
function redraw(file, pixel, opaque = false) {
  const { w, h } = pngSize(file)
  fs.writeFileSync(file, png(w, h, pixel, opaque))
  written.push(`${path.relative(here, file)} (${w}x${h})`)
}
function walk(dir, fn) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, fn); else if (e.name.endsWith('.png')) fn(p, e.name)
  }
}

// Android
walk(path.join(here, 'android/app/src/main/res'), (p, name) => {
  if (name === 'ic_launcher.png') redraw(p, shapes.rounded())
  else if (name === 'ic_launcher_round.png') redraw(p, shapes.circle())
  else if (name === 'ic_launcher_foreground.png') redraw(p, shapes.full(0.62))
  else if (name.startsWith('splash')) redraw(p, shapes.splash(), true)
})
const bgXml = path.join(here, 'android/app/src/main/res/values/ic_launcher_background.xml')
if (fs.existsSync(bgXml)) {
  fs.writeFileSync(bgXml, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#3F7FD0</color>\n</resources>\n')
}

// iOS (App Store icons must be opaque)
walk(path.join(here, 'ios/App/App/Assets.xcassets'), (p, name) => {
  if (p.includes('AppIcon.appiconset')) redraw(p, shapes.full(1), true)
  else if (p.includes('Splash.imageset')) redraw(p, shapes.splash(), true)
})

// Store listing icons
fs.mkdirSync(path.join(here, 'store'), { recursive: true })
fs.writeFileSync(path.join(here, 'store/icon-1024.png'), png(1024, 1024, shapes.full(1), true))
fs.writeFileSync(path.join(here, 'store/play-icon-512.png'), png(512, 512, shapes.full(1)))
written.push('store/icon-1024.png', 'store/play-icon-512.png')

console.log(`Redrew ${written.length} images:\n  ${written.join('\n  ')}`)
void inflateSync
