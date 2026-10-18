"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "../components/ui/button"
import { PauseIcon, PlayIcon, RotateCcwIcon, HomeIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import type {
  AvatarId,
  BlackHole,
  GameState,
  Gem,
  MonsterEntity,
  MonsterKind,
  Platform,
  PlatformKind,
  World,
} from "../types/game"
import { useSoundEffects } from "../hooks/useSoundEffects"
import { GAME_FONT } from "../lib/fonts"

// ---------------------------------------------------------------------------
// Tuning constants (units: px and seconds, y grows downward like the canvas)
// ---------------------------------------------------------------------------
const PLAYER_W = 48
const PLAYER_H = 40
const PLATFORM_W = 62
const PLATFORM_H = 15
const MONSTER_SIZE = 44
const GRAVITY = 1500
const JUMP_V = 760 // jump height = v^2 / 2g ~= 192px
const SPRING_V = 1450
const TRAMPOLINE_V = 1900
const SHOE_JUMPS = 5
const SHOE_MULT = 1.4
const SHIELD_DURATION = 8
const MOVE_ACCEL = 2800
const MAX_VX = 430
const MAX_FALL = 1200
const PROPELLER_DURATION = 3.5
const PROPELLER_V = 430
const JETPACK_DURATION = 3.0
const JETPACK_V = 950
const PELLET_V = 1100
const SUCK_DURATION = 0.7
const HUD_H = 44
const HIGH_SCORE_KEY = "monsterhop-highscore"
const MUTED_KEY = "monsterhop-muted"
// Score now includes kill/gem bonuses, so the BEST altitude line needs its
// own record of the highest climb rather than deriving it from the score.
const BEST_HEIGHT_KEY = "monsterhop-bestheight"
const GEM_SIZE = 20
const KILL_POINTS = 100
const GEM_POINTS = 25
// The starting ground sits this far below the screen bottom minus the pad
const GROUND_OFFSET = 60

const ZONES = [
  { at: 0, name: "Dusk Meadow" },
  { at: 6000, name: "Twilight Drift" },
  { at: 14000, name: "Starfield" },
  { at: 28000, name: "Deep Space" },
  { at: 42000, name: "The Void" },
]
const zoneIndex = (climb: number) => {
  let i = 0
  while (i < ZONES.length - 1 && climb >= ZONES[i + 1].at) i++
  return i
}

let idCounter = 0
const nextId = () => ++idCounter

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// localStorage can throw (private browsing, storage disabled) — never let that crash the game
const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore — the game just won't persist
  }
}

const difficulty = (climb: number) => clamp(climb / 40000, 0, 1)

// Deterministic pseudo-random values for background decorations
const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const bgRand = mulberry32(7)
const STARS = Array.from({ length: 90 }, () => ({
  fx: bgRand(),
  fy: bgRand(),
  size: 0.6 + bgRand() * 1.4,
  tw: 1 + bgRand() * 3,
}))
const FIREFLIES = Array.from({ length: 10 }, () => ({
  fx: bgRand(),
  fy: bgRand(),
  r: 2 + bgRand() * 2.5,
  sp: 0.3 + bgRand() * 0.7,
  ph: bgRand() * Math.PI * 2,
}))
// Big soft color washes that drift slowly behind everything
const NEBULAS = [
  { fx: 0.2, fy: 0.15, r: 0.55, color: "139,92,246" },
  { fx: 0.85, fy: 0.5, r: 0.5, color: "45,212,191" },
  { fx: 0.4, fy: 0.85, r: 0.6, color: "244,114,182" },
]

// Sky palette keyframes: [altitude, top color, bottom color] — dusk fades to deep space
const SKY_STOPS: [number, [number, number, number], [number, number, number]][] = [
  [0, [63, 44, 110], [244, 132, 92]],
  [6000, [28, 24, 72], [96, 60, 138]],
  [14000, [12, 10, 38], [42, 34, 88]],
  [28000, [4, 3, 14], [18, 14, 46]],
]

const skyColors = (altitude: number): { top: string; bottom: string } => {
  let i = 0
  while (i < SKY_STOPS.length - 2 && altitude > SKY_STOPS[i + 1][0]) i++
  const [a0, top0, bot0] = SKY_STOPS[i]
  const [a1, top1, bot1] = SKY_STOPS[i + 1]
  const t = clamp((altitude - a0) / (a1 - a0), 0, 1)
  const mix = (c0: [number, number, number], c1: [number, number, number]) =>
    `rgb(${Math.round(lerp(c0[0], c1[0], t))},${Math.round(lerp(c0[1], c1[1], t))},${Math.round(lerp(c0[2], c1[2], t))})`
  return { top: mix(top0, top1), bottom: mix(bot0, bot1) }
}

// ---------------------------------------------------------------------------
// World construction and spawning
// ---------------------------------------------------------------------------
const makePlatform = (x: number, y: number, kind: PlatformKind, width: number): Platform => ({
  id: nextId(),
  x,
  y,
  kind,
  baseX: x,
  phase: Math.random() * Math.PI * 2,
  speed: 1.1 + Math.random() * 1.1,
  // Swing only as far as there is room on the narrower side, so a moving
  // platform never slides off the edge of the screen.
  amp: kind === "moving" ? clamp(Math.min(x, width - PLATFORM_W - x), 0, 70) : 0,
  attachSide: Math.random() < 0.5 ? -1 : 1,
  sprungAt: 0,
  fadingAt: 0,
  landedAt: 0,
})

const attachAnchorX = (p: Platform) => (p.attachSide < 0 ? p.x + 7 : p.x + PLATFORM_W - 27)

const spawnRow = (w: World, width: number) => {
  const a = w.totalClimb
  const d = difficulty(a)
  const spacing = clamp(lerp(58, 128, d) * (0.75 + Math.random() * 0.5), 40, 135)

  // Platform mix shifts steadily against you as you climb
  let kind: PlatformKind = "green"
  const r = Math.random()
  if (a > 9000 && r < 0.1 + 0.14 * d) kind = "ghost"
  else if (a > 1500 && r < 0.24 + 0.42 * d) kind = "moving"

  // Moving platforms spawn inset from the edges so they have room to swing
  const span = width - PLATFORM_W
  const inset = kind === "moving" ? Math.min(35, span / 2) : 0
  // The main rung of each row wanders at most REACH px from the previous
  // one: on a wide desktop screen an unconstrained random x could place the
  // next platform further sideways than a single bounce can travel.
  const REACH = 260
  const lo = Math.max(inset, w.lastMainX - REACH)
  const hi = Math.min(span - inset, w.lastMainX + REACH)
  const x = lo + Math.random() * Math.max(0, hi - lo)
  w.lastMainX = x
  const platform = makePlatform(x, w.nextSpawnY, kind, width)
  // Moving platforms swing faster at altitude
  if (kind === "moving") platform.speed *= 1 + 0.5 * d

  // Power-ups sit only on plain green platforms, unlocking as you climb
  if (kind === "green") {
    const ir = Math.random()
    if (ir < 0.075) platform.attachment = "spring"
    else if (a > 1000 && ir < 0.105) platform.attachment = "trampoline"
    else if (a > 1500 && ir < 0.119) platform.attachment = "propeller"
    else if (a > 2500 && ir < 0.131) platform.attachment = "shoes"
    else if (a > 3500 && ir < 0.14) platform.attachment = "jetpack"
    else if (a > 5000 && ir < 0.152) platform.attachment = "shield"
  }
  w.platforms.push(platform)

  // Brown breakable platforms are decoys added *between* the real rungs
  if (a > 700 && Math.random() < 0.14 + 0.25 * d) {
    const bx = Math.random() * (width - PLATFORM_W)
    w.platforms.push(makePlatform(bx, w.nextSpawnY - spacing * (0.3 + Math.random() * 0.4), "breakable", width))
  }

  // On wide screens a single rung per row feels sparse — pad the row with
  // plain filler platforms across the rest of the width.
  const fillerSlots = Math.floor(width / 480)
  for (let i = 0; i < fillerSlots; i++) {
    if (Math.random() < 0.6) {
      const fx = Math.random() * span
      if (Math.abs(fx - x) > PLATFORM_W * 1.6) {
        const filler = makePlatform(fx, w.nextSpawnY - Math.random() * 20, "green", width)
        if (Math.random() < 0.05) filler.attachment = "spring"
        w.platforms.push(filler)
      }
    }
  }

  // Monsters get both more common and faster the higher you climb
  if (a > 2500 && Math.random() < 0.028 + 0.085 * d) {
    const mr = Math.random()
    const mkind: MonsterKind = a > 8000 && mr < 0.25 ? "ufo" : a > 4500 && mr < 0.55 ? "flyer" : "blob"
    const mx = Math.random() * (width - MONSTER_SIZE)
    w.monsters.push({
      id: nextId(),
      x: mx,
      y: w.nextSpawnY - spacing * 0.55 - MONSTER_SIZE,
      baseX: mx,
      kind: mkind,
      vx: (Math.random() < 0.5 ? -1 : 1) * (55 + 80 * d),
      phase: Math.random() * Math.PI * 2,
      nextShotAt: w.time + 1 + Math.random() * 2.5,
    })
  }

  // Black holes, kept away from the rung so there is always a path
  if (a > 6000 && Math.random() < 0.008 + 0.03 * d) {
    const hx = Math.random() * (width - 60) + 30
    if (Math.abs(hx - (x + PLATFORM_W / 2)) > 120) {
      w.holes.push({ id: nextId(), x: hx, y: w.nextSpawnY - spacing * 0.5, r: 26 })
    }
  }

  // Gems: occasional floating collectibles, sometimes strung in a little arc
  if (Math.random() < 0.09) {
    const count = Math.random() < 0.35 ? 3 + Math.floor(Math.random() * 3) : 1
    const gx = x + PLATFORM_W / 2 + (Math.random() - 0.5) * 160
    const gy = w.nextSpawnY - spacing * 0.5
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5
      w.gems.push({
        id: nextId(),
        x: clamp(gx + t * 100 - GEM_SIZE / 2, 4, width - GEM_SIZE - 4),
        y: gy - Math.cos(t * Math.PI) * 28,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  w.nextSpawnY -= spacing
}

const createWorld = (width: number, height: number): World => {
  const w: World = {
    player: {
      x: width / 2 - PLAYER_W / 2,
      y: height - 90 - PLAYER_H,
      vx: 0,
      vy: -JUMP_V * 0.5,
      dir: "right",
      gear: "none",
      gearUntil: 0,
      shootUntil: -1,
      shoeJumps: 0,
      shieldUntil: 0,
    },
    platforms: [],
    monsters: [],
    holes: [],
    pellets: [],
    enemyShots: [],
    shards: [],
    particles: [],
    gems: [],
    popups: [],
    time: 0,
    nextSpawnY: height - 90,
    lastMainX: width / 2 - PLATFORM_W / 2,
    totalClimb: 0,
    score: 0,
    bonus: 0,
    kills: 0,
    gemsCollected: 0,
    stompChain: 0,
    zone: 0,
    zoneBannerAt: -10,
    fellAt: 0,
    suckedAt: 0,
    suckX: 0,
    suckY: 0,
    shakeUntil: 0,
    shakeMag: 0,
    flashUntil: 0,
  }
  // Guaranteed launch pad under the player, then easy rows up the screen.
  // The ladder wanders (rather than teleporting) horizontally, and wide
  // screens get extra filler platforms, same as spawnRow.
  const span = width - PLATFORM_W
  w.platforms.push(makePlatform(w.lastMainX, height - 90, "green", width))
  w.nextSpawnY = height - 90 - 60
  while (w.nextSpawnY > -250) {
    const lo = Math.max(0, w.lastMainX - 220)
    const hi = Math.min(span, w.lastMainX + 220)
    const x = lo + Math.random() * Math.max(0, hi - lo)
    w.lastMainX = x
    w.platforms.push(makePlatform(x, w.nextSpawnY, "green", width))
    for (let i = 0; i < Math.floor(width / 480); i++) {
      if (Math.random() < 0.5) {
        const fx = Math.random() * span
        if (Math.abs(fx - x) > PLATFORM_W * 1.6) {
          w.platforms.push(makePlatform(fx, w.nextSpawnY - Math.random() * 15, "green", width))
        }
      }
    }
    w.nextSpawnY -= 55 + Math.random() * 25
  }
  return w
}

const MAX_PARTICLES = 260

const addParticles = (w: World, x: number, y: number, count: number, color: string, speed: number) => {
  // Hard ceiling so a pile-up of effects can never grow the array without bound
  if (w.particles.length > MAX_PARTICLES) w.particles.splice(0, w.particles.length - MAX_PARTICLES)
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const v = speed * (0.3 + Math.random() * 0.7)
    w.particles.push({
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v - speed * 0.4,
      life: 0.5,
      maxLife: 0.5,
      size: 2.5 + Math.random() * 3,
      color,
    })
  }
}

const addPopup = (w: World, x: number, y: number, text: string, color: string) => {
  if (w.popups.length > 20) w.popups.shift()
  w.popups.push({ x, y, text, color, life: 0.9 })
}

const shake = (w: World, duration: number, magnitude: number) => {
  // A small shake never weakens or shortens a bigger one already playing
  const active = w.time < w.shakeUntil
  w.shakeMag = active ? Math.max(w.shakeMag, magnitude) : magnitude
  w.shakeUntil = Math.max(w.shakeUntil, w.time + duration)
}

const groundY = (w: World, height: number) => height - GROUND_OFFSET + w.totalClimb

const breakPlatform = (w: World, p: Platform) => {
  w.platforms = w.platforms.filter((pl) => pl.id !== p.id)
  for (const flip of [false, true]) {
    w.shards.push({
      x: p.x + (flip ? PLATFORM_W / 2 : 0),
      y: p.y,
      vx: flip ? 40 : -40,
      vy: 60,
      rot: 0,
      vr: (flip ? 1 : -1) * (3 + Math.random() * 3),
      flip,
    })
  }
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------
const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

const PLATFORM_STYLE: Record<PlatformKind, { top: string; fill: string; stroke: string; glow: string }> = {
  green: { top: "#86efac", fill: "#22c55e", stroke: "#15803d", glow: "rgba(74,222,128,0.55)" },
  moving: { top: "#7dd3fc", fill: "#0ea5e9", stroke: "#0369a1", glow: "rgba(56,189,248,0.55)" },
  breakable: { top: "#fdba74", fill: "#f97316", stroke: "#9a3412", glow: "rgba(251,146,60,0.5)" },
  ghost: {
    top: "rgba(255,255,255,0.32)",
    fill: "rgba(255,255,255,0.1)",
    stroke: "rgba(255,255,255,0.75)",
    glow: "rgba(255,255,255,0.35)",
  },
}

const drawPlatformShape = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, kind: PlatformKind) => {
  const { top, fill, stroke, glow } = PLATFORM_STYLE[kind]
  const grad = ctx.createLinearGradient(0, y, 0, y + PLATFORM_H)
  grad.addColorStop(0, top)
  grad.addColorStop(1, fill)
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = 12
  ctx.fillStyle = grad
  rr(ctx, x, y, w, PLATFORM_H, 7)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2.5
  rr(ctx, x, y, w, PLATFORM_H, 7)
  ctx.stroke()
  ctx.strokeStyle = "rgba(255,255,255,0.45)"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x + 7, y + 4)
  ctx.lineTo(x + w - 9, y + 4)
  ctx.stroke()
  if (kind === "breakable") {
    ctx.strokeStyle = "rgba(124,45,18,0.85)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x + w * 0.45, y + 1)
    ctx.lineTo(x + w * 0.55, y + PLATFORM_H * 0.5)
    ctx.lineTo(x + w * 0.47, y + PLATFORM_H - 1)
    ctx.stroke()
  }
}

// Platforms are pre-rendered once per kind: shadowBlur glows are expensive,
// and a full-screen desktop field can show 30+ platforms every frame.
const SPRITE_PAD = 14
const platformSprites = new Map<string, HTMLCanvasElement>()
const getPlatformSprite = (kind: PlatformKind, dpr: number) => {
  const key = `${kind}@${dpr}`
  let sprite = platformSprites.get(key)
  if (!sprite) {
    sprite = document.createElement("canvas")
    sprite.width = Math.ceil((PLATFORM_W + SPRITE_PAD * 2) * dpr)
    sprite.height = Math.ceil((PLATFORM_H + SPRITE_PAD * 2) * dpr)
    const c = sprite.getContext("2d")
    if (c) {
      c.scale(dpr, dpr)
      drawPlatformShape(c, SPRITE_PAD, SPRITE_PAD, PLATFORM_W, kind)
    }
    platformSprites.set(key, sprite)
  }
  return sprite
}

const drawPlatform = (ctx: CanvasRenderingContext2D, p: Platform, time: number, dpr: number) => {
  ctx.save()
  if (p.kind === "ghost" && p.fadingAt > 0) {
    ctx.globalAlpha = clamp(1 - (time - p.fadingAt) / 0.35, 0, 1)
  }
  // Brief dip under the player's weight on each bounce
  if (p.landedAt > 0 && time - p.landedAt < 0.22) {
    ctx.translate(0, Math.sin(((time - p.landedAt) / 0.22) * Math.PI) * 4)
  }
  ctx.drawImage(
    getPlatformSprite(p.kind, dpr),
    p.x - SPRITE_PAD,
    p.y - SPRITE_PAD,
    PLATFORM_W + SPRITE_PAD * 2,
    PLATFORM_H + SPRITE_PAD * 2,
  )

  // Attachments
  if (p.attachment === "spring") {
    const sx = attachAnchorX(p)
    const extended = time - p.sprungAt < 0.25 && p.sprungAt > 0
    const h = extended ? 20 : 10
    ctx.strokeStyle = "#6b7280"
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const yy = p.y - (h * i) / 3
      ctx.moveTo(sx + 3, yy)
      ctx.lineTo(sx + 17, yy - h / 6)
    }
    ctx.stroke()
    ctx.fillStyle = "#ef4444"
    ctx.strokeStyle = "#991b1b"
    ctx.lineWidth = 2
    rr(ctx, sx, p.y - h - 6, 20, 7, 3)
    ctx.fill()
    ctx.stroke()
  } else if (p.attachment === "trampoline") {
    const cx = p.x + PLATFORM_W / 2
    const extended = time - p.sprungAt < 0.25 && p.sprungAt > 0
    const topY = p.y - (extended ? 15 : 9)
    ctx.strokeStyle = "#475569"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx - 15, p.y)
    ctx.lineTo(cx - 11, topY + 4)
    ctx.moveTo(cx + 15, p.y)
    ctx.lineTo(cx + 11, topY + 4)
    ctx.stroke()
    ctx.fillStyle = "#1e293b"
    ctx.strokeStyle = "#0f172a"
    rr(ctx, cx - 19, topY, 38, 6, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#ef4444"
    rr(ctx, cx - 17, topY + 1, 34, 2.5, 1)
    ctx.fill()
  } else if (p.attachment === "shoes") {
    const sx = attachAnchorX(p)
    ctx.strokeStyle = "#6b7280"
    ctx.lineWidth = 1.8
    for (const off of [1, 12]) {
      ctx.beginPath()
      ctx.moveTo(sx + off, p.y - 1)
      ctx.lineTo(sx + off + 6, p.y - 4)
      ctx.moveTo(sx + off, p.y - 4)
      ctx.lineTo(sx + off + 6, p.y - 7)
      ctx.stroke()
    }
    ctx.fillStyle = "#f43f5e"
    ctx.strokeStyle = "#9f1239"
    ctx.lineWidth = 1.8
    for (const off of [0, 11]) {
      rr(ctx, sx + off, p.y - 14, 9, 7, 3)
      ctx.fill()
      ctx.stroke()
    }
  } else if (p.attachment === "shield") {
    const cx = attachAnchorX(p) + 10
    const cy = p.y - 14
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 10)
    grad.addColorStop(0, "rgba(165,243,252,0.9)")
    grad.addColorStop(1, "rgba(34,211,238,0.25)")
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "#22d3ee"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = "rgba(255,255,255,0.9)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, 6, -0.9 * Math.PI, -0.5 * Math.PI)
    ctx.stroke()
  } else if (p.attachment === "propeller") {
    const sx = attachAnchorX(p)
    ctx.fillStyle = "#f4b93c"
    ctx.strokeStyle = "#a16207"
    ctx.lineWidth = 2
    rr(ctx, sx + 2, p.y - 12, 16, 10, 5)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = "#57534e"
    ctx.beginPath()
    ctx.moveTo(sx + 10, p.y - 12)
    ctx.lineTo(sx + 10, p.y - 17)
    ctx.stroke()
    ctx.fillStyle = "#e7e5e4"
    ctx.strokeStyle = "#78716c"
    rr(ctx, sx - 2, p.y - 21, 24, 5, 2.5)
    ctx.fill()
    ctx.stroke()
  } else if (p.attachment === "jetpack") {
    const sx = attachAnchorX(p)
    ctx.fillStyle = "#cbd5e1"
    ctx.strokeStyle = "#64748b"
    ctx.lineWidth = 2
    rr(ctx, sx + 3, p.y - 22, 14, 20, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#f59e0b"
    ctx.beginPath()
    ctx.moveTo(sx + 6, p.y - 2)
    ctx.lineTo(sx + 10, p.y + 4)
    ctx.lineTo(sx + 14, p.y - 2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// `charge` (0..1) telegraphs an incoming shot so enemy fire is reactable
const drawMonster = (ctx: CanvasRenderingContext2D, m: MonsterEntity, time: number, charge = 0) => {
  const s = MONSTER_SIZE
  ctx.save()
  if (charge > 0) {
    const cx = m.x + s / 2
    const cy = m.y + s / 2
    const r = s * (0.55 + 0.25 * charge) + Math.sin(time * 40) * 1.5
    const g = ctx.createRadialGradient(cx, cy, s * 0.2, cx, cy, r)
    g.addColorStop(0, `rgba(232,121,249,${(0.45 * charge).toFixed(3)})`)
    g.addColorStop(1, "rgba(232,121,249,0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  if (m.kind === "blob") {
    const wob = Math.sin(time * 5 + m.phase) * 2
    const cx = m.x + s / 2
    const cy = m.y + s / 2
    ctx.fillStyle = "#5ec8f2"
    ctx.strokeStyle = "#26789e"
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.ellipse(cx, cy, s / 2 - 2 + wob, s / 2 - 4 - wob, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // spikes
    ctx.fillStyle = "#2d95c4"
    for (const off of [-12, 0, 12]) {
      ctx.beginPath()
      ctx.moveTo(cx + off - 4, cy - s / 2 + 6)
      ctx.lineTo(cx + off, cy - s / 2 - 4 + wob)
      ctx.lineTo(cx + off + 4, cy - s / 2 + 6)
      ctx.closePath()
      ctx.fill()
    }
    drawEyes(ctx, cx, cy - 2, 8, 0)
    ctx.strokeStyle = "#1e5a78"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy + 8, 6, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
  } else if (m.kind === "flyer") {
    const cx = m.x + s / 2
    const cy = m.y + s / 2 + Math.sin(time * 3 + m.phase) * 4
    const flap = Math.sin(time * 14 + m.phase) * 0.4
    ctx.fillStyle = "rgba(254,205,211,0.9)"
    ctx.strokeStyle = "#e11d48"
    ctx.lineWidth = 2
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.translate(cx + side * (s / 2 - 4), cy - 2)
      ctx.rotate(side * (0.5 - flap))
      ctx.beginPath()
      ctx.ellipse(side * 8, 0, 11, 5.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    ctx.fillStyle = "#fb7185"
    ctx.strokeStyle = "#be123c"
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.ellipse(cx, cy, s / 2 - 5, s / 2 - 7, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    drawEyes(ctx, cx, cy - 3, 7, m.vx >= 0 ? 1.5 : -1.5)
    ctx.strokeStyle = "#881337"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy + 6, 5, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.stroke()
  } else {
    // UFO
    const cx = m.x + s / 2
    const cy = m.y + s / 2 + Math.sin(time * 2 + m.phase) * 3
    ctx.fillStyle = "rgba(147,197,253,0.75)"
    ctx.strokeStyle = "#3b82f6"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy - 4, 12, Math.PI, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#cbd5e1"
    ctx.strokeStyle = "#64748b"
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.ellipse(cx, cy, s / 2, 9, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    for (let i = 0; i < 3; i++) {
      const blink = 0.4 + 0.6 * Math.abs(Math.sin(time * 5 + i * 2 + m.phase))
      ctx.fillStyle = `rgba(250,204,21,${blink.toFixed(2)})`
      ctx.beginPath()
      ctx.arc(cx - 12 + i * 12, cy + 3, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

const drawEyes = (ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, pupilOffset: number) => {
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#fff"
    ctx.strokeStyle = "rgba(0,0,0,0.4)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx + side * gap, cy, 5.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#111"
    ctx.beginPath()
    ctx.arc(cx + side * gap + pupilOffset, cy, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

const drawBlackHole = (ctx: CanvasRenderingContext2D, h: BlackHole, time: number) => {
  const glow = ctx.createRadialGradient(h.x, h.y, h.r * 0.4, h.x, h.y, h.r * 1.9)
  glow.addColorStop(0, "rgba(150,100,255,0.4)")
  glow.addColorStop(1, "rgba(150,100,255,0)")
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(h.x, h.y, h.r * 1.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#0c0a14"
  ctx.beginPath()
  ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "rgba(168,120,255,0.8)"
  ctx.lineWidth = 2.5
  for (const off of [0, Math.PI]) {
    ctx.beginPath()
    ctx.ellipse(h.x, h.y, h.r * 0.85, h.r * 0.35, time * 1.6 + off, 0.2, Math.PI - 0.2)
    ctx.stroke()
  }
}

const drawGem = (ctx: CanvasRenderingContext2D, g: Gem, time: number) => {
  const s = GEM_SIZE
  const cx = g.x + s / 2
  const cy = g.y + s / 2 + Math.sin(time * 3 + g.phase) * 3
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, s)
  glow.addColorStop(0, "rgba(253,224,71,0.45)")
  glow.addColorStop(1, "rgba(253,224,71,0)")
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, s, 0, Math.PI * 2)
  ctx.fill()

  const w = s * 0.5
  const h = s * 0.55
  const body = ctx.createLinearGradient(cx - w, cy - h, cx + w, cy + h)
  body.addColorStop(0, "#fef9c3")
  body.addColorStop(0.45, "#facc15")
  body.addColorStop(1, "#d97706")
  ctx.fillStyle = body
  ctx.strokeStyle = "#92400e"
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(cx - w, cy - h * 0.25)
  ctx.lineTo(cx - w * 0.5, cy - h * 0.75)
  ctx.lineTo(cx + w * 0.5, cy - h * 0.75)
  ctx.lineTo(cx + w, cy - h * 0.25)
  ctx.lineTo(cx, cy + h)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Facets
  ctx.strokeStyle = "rgba(146,64,14,0.55)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - w, cy - h * 0.25)
  ctx.lineTo(cx + w, cy - h * 0.25)
  ctx.moveTo(cx - w * 0.5, cy - h * 0.75)
  ctx.lineTo(cx - w * 0.15, cy - h * 0.25)
  ctx.lineTo(cx, cy + h)
  ctx.moveTo(cx + w * 0.5, cy - h * 0.75)
  ctx.lineTo(cx + w * 0.15, cy - h * 0.25)
  ctx.lineTo(cx, cy + h)
  ctx.stroke()
  // Twinkle
  const tw = Math.max(0, Math.sin(time * 4 + g.phase * 3))
  if (tw > 0.2) {
    const sx = cx + w * 0.55
    const sy = cy - h * 0.8
    const r = 4 * tw
    ctx.fillStyle = `rgba(255,255,255,${tw.toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(sx, sy - r)
    ctx.lineTo(sx + r * 0.25, sy - r * 0.25)
    ctx.lineTo(sx + r, sy)
    ctx.lineTo(sx + r * 0.25, sy + r * 0.25)
    ctx.lineTo(sx, sy + r)
    ctx.lineTo(sx - r * 0.25, sy + r * 0.25)
    ctx.lineTo(sx - r, sy)
    ctx.lineTo(sx - r * 0.25, sy - r * 0.25)
    ctx.closePath()
    ctx.fill()
  }
}

// --- Starting ground: a hill you launch from, which scrolls away as you climb
const groundRand = mulberry32(99)
const GROUND_DECOR = Array.from({ length: 16 }, () => ({
  fx: groundRand(),
  tree: groundRand() < 0.45,
  s: 0.7 + groundRand() * 0.8,
  ph: groundRand() * Math.PI * 2,
}))

const hillY = (x: number, base: number, amp: number, seed: number) =>
  base - amp * (0.5 + 0.3 * Math.sin(x * 0.006 + seed) + 0.2 * Math.sin(x * 0.017 + seed * 2.3))

// The walkable ground surface at screen x (matches what is drawn)
const groundSurface = (x: number, gy: number) => hillY(x, gy + 18, 14, 4.2)

const drawGround = (ctx: CanvasRenderingContext2D, gy: number, width: number, height: number, climb: number, time: number) => {
  // Far hills recede more slowly than the ground for a touch of depth
  const backBase = height - 100 + climb * 0.55
  if (backBase - 90 < height) {
    ctx.fillStyle = "rgba(46,32,96,0.9)"
    ctx.beginPath()
    ctx.moveTo(0, height + 5)
    for (let x = 0; x <= width + 20; x += 20) ctx.lineTo(x, hillY(x, backBase, 70, 1.7))
    ctx.lineTo(width + 20, height + 5)
    ctx.closePath()
    ctx.fill()
  }
  if (gy - 60 > height) return

  for (const d of GROUND_DECOR) {
    const x = d.fx * width
    const y = groundSurface(x, gy) + 2
    if (d.tree) {
      const h = 46 * d.s
      ctx.fillStyle = "#1c1442"
      for (let i = 0; i < 3; i++) {
        const tw = (14 - i * 3.5) * d.s
        const ty = y - h * (0.3 + i * 0.25)
        ctx.beginPath()
        ctx.moveTo(x - tw, ty + h * 0.3)
        ctx.lineTo(x, ty - h * 0.18)
        ctx.lineTo(x + tw, ty + h * 0.3)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      const sz = 7 * d.s
      const pulse = 0.6 + 0.4 * Math.sin(time * 2 + d.ph)
      ctx.fillStyle = "#2a1f5c"
      ctx.fillRect(x - sz * 0.22, y - sz * 1.2, sz * 0.44, sz * 1.2)
      ctx.save()
      ctx.shadowColor = "rgba(196,181,253,0.9)"
      ctx.shadowBlur = 10 * pulse
      ctx.fillStyle = `rgba(196,181,253,${(0.55 + 0.35 * pulse).toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(x, y - sz * 1.2, sz, sz * 0.62, 0, Math.PI, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  ctx.fillStyle = "#150f33"
  ctx.beginPath()
  ctx.moveTo(0, Math.max(height, gy) + 40)
  for (let x = 0; x <= width + 20; x += 16) ctx.lineTo(x, groundSurface(x, gy))
  ctx.lineTo(width + 20, Math.max(height, gy) + 40)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = "rgba(167,139,250,0.45)"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = 0; x <= width + 20; x += 16) {
    const y = groundSurface(x, gy)
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Avatars — five original monsters, each with its own silhouette. All are
// drawn centred on (0,0) facing right; the caller mirrors/squashes/rotates.
// ---------------------------------------------------------------------------
const AVATAR_IDS: AvatarId[] = ["gloop", "batty", "ember", "squiddy", "boo"]
const AVATAR_NAMES: Record<AvatarId, string> = {
  gloop: "Gloop",
  batty: "Batty",
  ember: "Ember",
  squiddy: "Squiddy",
  boo: "Boo",
}
const AVATAR_TAGLINES: Record<AvatarId, string> = {
  gloop: "Squishy, sticky, always optimistic",
  batty: "Night owl. Well — night bat.",
  ember: "Hot-headed and hopping mad",
  squiddy: "Honestly too sleepy for this",
  boo: "Shy, spooky, surprisingly bouncy",
}
const AVATAR_KEY = "monsterhop-avatar"

interface AvatarPose {
  time: number
  shooting: boolean
  dead: boolean
}

const drawXEyes = (ctx: CanvasRenderingContext2D, pts: [number, number][], color: string) => {
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5
  for (const [ex, ey] of pts) {
    ctx.beginPath()
    ctx.moveTo(ex - 3.5, ey - 3.5)
    ctx.lineTo(ex + 3.5, ey + 3.5)
    ctx.moveTo(ex + 3.5, ey - 3.5)
    ctx.lineTo(ex - 3.5, ey + 3.5)
    ctx.stroke()
  }
}

const drawBlush = (ctx: CanvasRenderingContext2D, points: [number, number][]) => {
  for (const [cx, cy] of points) {
    const blush = ctx.createRadialGradient(cx, cy, 0, cx, cy, 5)
    blush.addColorStop(0, "rgba(255,150,155,0.9)")
    blush.addColorStop(1, "rgba(255,150,155,0)")
    ctx.fillStyle = blush
    ctx.beginPath()
    ctx.ellipse(cx, cy, 5, 3.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

const drawAvatarBody = (ctx: CanvasRenderingContext2D, id: AvatarId, o: AvatarPose) => {
  switch (id) {
    case "gloop": {
      // A melty lime slime with one big eye and an antenna
      const wob = Math.sin(o.time * 5) * 1.5
      ctx.fillStyle = "#a3e635"
      ctx.strokeStyle = "#4d7c0f"
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(0, -1, 21 + wob * 0.5, 17 - wob * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      for (const [dx, r] of [
        [-12, 5],
        [0, 6],
        [12, 5],
      ] as const) {
        ctx.beginPath()
        ctx.arc(dx, 13, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.strokeStyle = "#4d7c0f"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, -17)
      ctx.quadraticCurveTo(3, -23, 0, -27)
      ctx.stroke()
      ctx.fillStyle = o.shooting ? "#fef08a" : "#65a30d"
      ctx.beginPath()
      ctx.arc(0, -28, 3.5, 0, Math.PI * 2)
      ctx.fill()
      if (o.dead) {
        drawXEyes(ctx, [[0, -4]], "#365314")
      } else {
        ctx.fillStyle = "#fff"
        ctx.strokeStyle = "#4d7c0f"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, -4, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = "#1a2e05"
        ctx.beginPath()
        ctx.arc(o.shooting ? 0 : 2.5, o.shooting ? -7 : -4, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        ctx.beginPath()
        ctx.arc(1, -7, 1.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#365314"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 7, 5, 0.15 * Math.PI, 0.85 * Math.PI)
        ctx.stroke()
      }
      break
    }
    case "batty": {
      // A round fuzzball with bat ears, little wings and fangs
      const flap = Math.sin(o.time * 10) * 0.4
      ctx.fillStyle = "rgba(216,180,254,0.9)"
      ctx.strokeStyle = "#7e22ce"
      ctx.lineWidth = 2
      for (const s of [-1, 1] as const) {
        ctx.save()
        ctx.translate(s * 17, 0)
        ctx.rotate(s * (0.6 - flap))
        ctx.beginPath()
        ctx.ellipse(s * 8, 0, 10, 5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
      ctx.strokeStyle = "#7e22ce"
      ctx.lineWidth = 2.5
      for (const s of [-1, 1] as const) {
        ctx.fillStyle = "#c084fc"
        ctx.beginPath()
        ctx.moveTo(s * 5, -13)
        ctx.lineTo(s * 14, -27)
        ctx.lineTo(s * 16, -10)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = "#f0abfc"
        ctx.beginPath()
        ctx.moveTo(s * 8, -14)
        ctx.lineTo(s * 13, -21)
        ctx.lineTo(s * 14, -13)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = "#c084fc"
      ctx.beginPath()
      ctx.arc(0, 0, 18, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (o.dead) {
        drawXEyes(
          ctx,
          [
            [-7, -3],
            [7, -3],
          ],
          "#3b0764",
        )
      } else {
        for (const s of [-1, 1] as const) {
          ctx.fillStyle = "#fff"
          ctx.strokeStyle = "#7e22ce"
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(s * 7, -3, 5.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = "#2e1065"
          ctx.beginPath()
          ctx.arc(s * 7 + (o.shooting ? 0 : 1.5), -3 + (o.shooting ? -2 : 0), 2.6, 0, Math.PI * 2)
          ctx.fill()
        }
        if (o.shooting) {
          ctx.fillStyle = "#3b0764"
          ctx.beginPath()
          ctx.ellipse(0, 7, 3.5, 4.5, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.strokeStyle = "#3b0764"
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(0, 5, 5, 0.15 * Math.PI, 0.85 * Math.PI)
          ctx.stroke()
          ctx.fillStyle = "#fff"
          for (const s of [-1, 1] as const) {
            ctx.beginPath()
            ctx.moveTo(s * 3 - 1.5, 8.5)
            ctx.lineTo(s * 3, 12)
            ctx.lineTo(s * 3 + 1.5, 8.5)
            ctx.closePath()
            ctx.fill()
          }
        }
        drawBlush(ctx, [
          [-12, 3],
          [12, 3],
        ])
      }
      break
    }
    case "ember": {
      // A grumpy little magma chunk with a spiky mohawk and a toothy grin
      ctx.fillStyle = "#fb923c"
      ctx.strokeStyle = "#c2410c"
      ctx.lineWidth = 2.5
      rr(ctx, -19, -16, 38, 34, 12)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = "#ea580c"
      ctx.strokeStyle = "#c2410c"
      ctx.lineWidth = 2
      for (let i = -2; i <= 2; i++) {
        const sx = i * 8
        ctx.beginPath()
        ctx.moveTo(sx - 4, -15)
        ctx.lineTo(sx, -26 - (i === 0 ? 3 : 0))
        ctx.lineTo(sx + 4, -15)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      ctx.fillStyle = "#fb923c"
      for (const s of [-1, 1] as const) {
        ctx.beginPath()
        ctx.arc(s * 21, 6, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      if (o.dead) {
        drawXEyes(
          ctx,
          [
            [-7, -5],
            [7, -5],
          ],
          "#7c2d12",
        )
      } else {
        ctx.strokeStyle = "#7c2d12"
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(-11, -11)
        ctx.lineTo(-3, -8)
        ctx.moveTo(11, -11)
        ctx.lineTo(3, -8)
        ctx.stroke()
        for (const s of [-1, 1] as const) {
          ctx.fillStyle = "#fff"
          ctx.strokeStyle = "#c2410c"
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(s * 7, -4, 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = "#431407"
          ctx.beginPath()
          ctx.arc(s * 7 + (o.shooting ? 0 : 1.5), -4 + (o.shooting ? -2 : 0), 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
        if (o.shooting) {
          ctx.fillStyle = "#431407"
          ctx.beginPath()
          ctx.ellipse(0, 7, 4, 5, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillStyle = "#431407"
          rr(ctx, -8, 4, 16, 6, 3)
          ctx.fill()
          ctx.fillStyle = "#fff"
          for (const tx of [-6, -1, 4]) {
            rr(ctx, tx, 4, 4, 3, 1)
            ctx.fill()
          }
        }
      }
      break
    }
    case "squiddy": {
      // A sleepy teal squid whose tentacles trail as it bounces
      for (let i = 0; i < 4; i++) {
        const tx = -12 + i * 8
        const sway = Math.sin(o.time * 6 + i * 1.3) * 3
        ctx.lineCap = "round"
        ctx.strokeStyle = "#0f766e"
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.moveTo(tx, 6)
        ctx.quadraticCurveTo(tx + sway, 13, tx + sway * 1.6, 19)
        ctx.stroke()
        ctx.strokeStyle = "#2dd4bf"
        ctx.lineWidth = 4.5
        ctx.beginPath()
        ctx.moveTo(tx, 6)
        ctx.quadraticCurveTo(tx + sway, 13, tx + sway * 1.6, 19)
        ctx.stroke()
      }
      ctx.lineCap = "butt"
      ctx.fillStyle = "#2dd4bf"
      ctx.strokeStyle = "#0f766e"
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(0, -2, 18, 18, 0, Math.PI, Math.PI * 2)
      ctx.lineTo(18, 8)
      ctx.quadraticCurveTo(0, 12, -18, 8)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = "rgba(153,246,228,0.7)"
      for (const [px, py, pr] of [
        [-9, -12, 2.5],
        [6, -15, 2],
        [11, -8, 1.6],
      ] as const) {
        ctx.beginPath()
        ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.fill()
      }
      if (o.dead) {
        drawXEyes(
          ctx,
          [
            [-7, -1],
            [7, -1],
          ],
          "#134e4a",
        )
      } else {
        for (const s of [-1, 1] as const) {
          ctx.fillStyle = "#fff"
          ctx.strokeStyle = "#0f766e"
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(s * 7, -1, 5.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = "#042f2e"
          ctx.beginPath()
          ctx.arc(s * 7 + (o.shooting ? 0 : 1.5), o.shooting ? -3 : 1, 2.6, 0, Math.PI * 2)
          ctx.fill()
          if (!o.shooting) {
            // Heavy eyelids for the sleepy look
            ctx.fillStyle = "#2dd4bf"
            ctx.beginPath()
            ctx.arc(s * 7, -2.5, 5.8, Math.PI, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.strokeStyle = "#134e4a"
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(-3, 6)
        ctx.quadraticCurveTo(-1.5, 8, 0, 6)
        ctx.quadraticCurveTo(1.5, 8, 3, 6)
        ctx.stroke()
      }
      break
    }
    case "boo": {
      // A friendly ghost with a wavy hem and hollow eyes
      ctx.save()
      ctx.shadowColor = "rgba(255,255,255,0.5)"
      ctx.shadowBlur = 10
      ctx.fillStyle = "rgba(241,245,249,0.95)"
      ctx.beginPath()
      ctx.ellipse(0, -4, 17, 16, 0, Math.PI, Math.PI * 2)
      ctx.lineTo(17, 8)
      let hx = 17
      for (let i = 0; i < 3; i++) {
        const nx = hx - 34 / 3
        ctx.quadraticCurveTo((hx + nx) / 2, 14 + Math.sin(o.time * 8 + i) * 1.2, nx, 8)
        hx = nx
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.strokeStyle = "#94a3b8"
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = "rgba(241,245,249,0.95)"
      for (const s of [-1, 1] as const) {
        ctx.beginPath()
        ctx.ellipse(s * 18, 2, 5, 3.5, s * 0.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      if (o.dead) {
        drawXEyes(
          ctx,
          [
            [-6.5, -6],
            [6.5, -6],
          ],
          "#334155",
        )
      } else {
        ctx.fillStyle = "#334155"
        for (const s of [-1, 1] as const) {
          ctx.beginPath()
          ctx.ellipse(s * 6.5 + (o.shooting ? 0 : 1), -6 + (o.shooting ? -1.5 : 0), 2.8, o.shooting ? 4.5 : 3.5, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.ellipse(0, 2, o.shooting ? 4.5 : 3, o.shooting ? 5.5 : 4, 0, 0, Math.PI * 2)
        ctx.fill()
        drawBlush(ctx, [
          [-12, -1],
          [12, -1],
        ])
      }
      break
    }
  }
}

// Preview canvas for the menu. `animate` gives the selected monster a live
// idle hop; the rest stay still so five rAF loops aren't running at once.
function AvatarPreview({ id, size = 56, animate = false }: { id: AvatarId; size?: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size * dpr
    cv.height = size * dpr
    const scale = size / 64
    const paint = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      const hop = animate ? Math.abs(Math.sin(t * 3.2)) : 0
      const squash = animate ? 1 + 0.08 * (1 - hop) * (1 - hop) : 1
      ctx.save()
      ctx.translate(size / 2, size * 0.56 - hop * size * 0.1)
      ctx.scale(scale * 1.05 * squash, (scale * 1.05) / squash)
      drawAvatarBody(ctx, id, { time: animate ? t : 1.2, shooting: false, dead: false })
      ctx.restore()
    }
    if (!animate) {
      paint(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const loop = (now: number) => {
      paint((now - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [id, size, animate])
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MonsterHop() {
  const [gameState, setGameState] = useState<GameState>("menu")
  const [highScore, setHighScore] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [avatar, setAvatarState] = useState<AvatarId>("gloop")
  const [finalStats, setFinalStats] = useState({
    score: 0,
    kills: 0,
    gems: 0,
    height: 0,
    zone: 0,
    cause: "",
    isNewBest: false,
  })
  const [shownScore, setShownScore] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const stateRef = useRef<GameState>("menu")
  const highScoreRef = useRef(0)
  const keysRef = useRef({ left: false, right: false })
  const pointerRef = useRef({ active: false, x: 0, y: 0, downX: 0, downAt: 0, moved: false })
  const tickRef = useRef<(dt: number) => void>(() => {})
  const reducedMotionRef = useRef(false)
  const avatarRef = useRef<AvatarId>("gloop")
  const bestHeightRef = useRef(0)
  const deathCauseRef = useRef("")
  const vignetteRef = useRef<{ w: number; h: number; grad: CanvasGradient | null }>({ w: 0, h: 0, grad: null })

  const sounds = useSoundEffects()

  const setState = useCallback((s: GameState) => {
    stateRef.current = s
    setGameState(s)
  }, [])

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    const stored = Number(readStorage(HIGH_SCORE_KEY) ?? 0)
    if (Number.isFinite(stored) && stored > 0) {
      setHighScore(stored)
      highScoreRef.current = stored
    }
    setIsMuted(readStorage(MUTED_KEY) === "1")
    const bestHeight = Number(readStorage(BEST_HEIGHT_KEY) ?? 0)
    if (Number.isFinite(bestHeight) && bestHeight > 0) bestHeightRef.current = bestHeight
    // Saves from before bonuses existed scored pure height (climb / 2)
    else if (Number.isFinite(stored) && stored > 0) bestHeightRef.current = stored * 2
    const savedAvatar = readStorage(AVATAR_KEY)
    if (savedAvatar && (AVATAR_IDS as string[]).includes(savedAvatar)) {
      avatarRef.current = savedAvatar as AvatarId
      setAvatarState(savedAvatar as AvatarId)
    }
  }, [])

  const setAvatar = useCallback((id: AvatarId) => {
    avatarRef.current = id
    setAvatarState(id)
    writeStorage(AVATAR_KEY, id)
  }, [])

  // Honour the OS "reduce motion" setting for the camera shake
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => {
      reducedMotionRef.current = mq.matches
    }
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    sounds.setMuted(isMuted)
    writeStorage(MUTED_KEY, isMuted ? "1" : "0")
  }, [isMuted, sounds])

  // Canvas sizing (device-pixel-ratio aware)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return // layout not settled yet
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      sizeRef.current = { w, h, dpr }
      const world = worldRef.current
      if (!world || stateRef.current === "menu") {
        worldRef.current = createWorld(w, h)
      } else {
        // Keep everything reachable when the window narrows mid-game
        for (const p of world.platforms) {
          p.x = clamp(p.x, 0, Math.max(0, w - PLATFORM_W))
          p.baseX = clamp(p.baseX, 0, Math.max(0, w - PLATFORM_W))
        }
        world.player.x = clamp(world.player.x, 0, Math.max(0, w - PLAYER_W))
      }
    }
    resize()
    // ResizeObserver catches the initial layout settling and any later
    // viewport changes (including mobile URL-bar show/hide).
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener("resize", resize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", resize)
    }
  }, [])

  // ---------------------------------------------------------------- endings
  const endGame = useCallback(() => {
    const w = worldRef.current
    if (!w) return
    const score = w.score
    const isNewBest = score > highScoreRef.current
    if (isNewBest) {
      highScoreRef.current = score
      setHighScore(score)
      writeStorage(HIGH_SCORE_KEY, String(score))
    }
    if (w.totalClimb > bestHeightRef.current) {
      bestHeightRef.current = w.totalClimb
      writeStorage(BEST_HEIGHT_KEY, String(Math.floor(w.totalClimb)))
    }
    setFinalStats({
      score,
      kills: w.kills,
      gems: w.gemsCollected,
      height: Math.floor(w.totalClimb / 10),
      zone: w.zone,
      cause: deathCauseRef.current || "Took a long fall",
      isNewBest,
    })
    sounds.playGameOver()
    setState("gameOver")
  }, [setState, sounds])

  const die = useCallback(
    (w: World, cause: string) => {
      sounds.playHit()
      deathCauseRef.current = cause
      w.fellAt = w.time
      shake(w, 0.4, 8)
      w.flashUntil = w.time + 0.18
      w.stompChain = 0
      w.player.vy = -420
      w.player.gear = "none"
      w.player.shoeJumps = 0
      w.player.shieldUntil = 0
      addParticles(w, w.player.x + PLAYER_W / 2, w.player.y + PLAYER_H / 2, 14, "#f87171", 240)
      setState("falling")
    },
    [setState, sounds],
  )

  // Shoot straight up, or toward a point when the player taps/clicks one
  // (both aiming modes exist in the original).
  const shoot = useCallback(
    (aimAt?: { x: number; y: number }) => {
      const w = worldRef.current
      if (!w || stateRef.current !== "playing") return
      if (w.time < w.player.shootUntil) return
      w.player.shootUntil = w.time + 0.22
      const originX = w.player.x + PLAYER_W / 2
      const originY = w.player.y - 4
      let vx = 0
      let vy = -PELLET_V
      if (aimAt) {
        const dx = aimAt.x - originX
        const dy = aimAt.y - originY
        const len = Math.hypot(dx, dy)
        if (len > 1) {
          vx = (dx / len) * PELLET_V
          vy = (dy / len) * PELLET_V
        }
      }
      if (w.pellets.length < 24) {
        w.pellets.push({ id: nextId(), x: originX, y: originY, vx, vy })
      }
      sounds.playShoot()
    },
    [sounds],
  )

  // ------------------------------------------------------------------- tick
  const tick = (dt: number) => {
    const { w: width, h: height } = sizeRef.current
    const world = worldRef.current
    const canvas = canvasRef.current
    if (!world || !canvas || width === 0) return
    const st = stateRef.current
    if (process.env.NODE_ENV !== "production") {
      // Dev-only debug handle: lets a console session inspect the world and
      // step the simulation deterministically (rAF is throttled when hidden).
      ;(
        window as unknown as {
          __mh?: { world: World; state: GameState; step: (dt: number) => void; setState: (s: GameState) => void }
        }
      ).__mh = { world, state: st, step: (d: number) => tickRef.current(d), setState }
    }

    if (st !== "paused" && st !== "gameOver") {
      world.time += dt

      // Ambient motion runs in every live state
      for (const pl of world.platforms) {
        if (pl.kind === "moving") pl.x = pl.baseX + Math.sin(world.time * pl.speed + pl.phase) * pl.amp
      }
      for (const pt of world.particles) {
        pt.x += pt.vx * dt
        pt.y += pt.vy * dt
        pt.vy += GRAVITY * 0.5 * dt
        pt.life -= dt
      }
      world.particles = world.particles.filter((pt) => pt.life > 0)
      for (const pu of world.popups) {
        pu.y -= 42 * dt
        pu.life -= dt
      }
      world.popups = world.popups.filter((pu) => pu.life > 0)
      for (const sh of world.shards) {
        sh.x += sh.vx * dt
        sh.y += sh.vy * dt
        sh.vy += GRAVITY * 0.8 * dt
        sh.rot += sh.vr * dt
      }
      world.shards = world.shards.filter((sh) => sh.y < height + 60)
      world.platforms = world.platforms.filter(
        (pl) => pl.fadingAt === 0 || world.time - pl.fadingAt < 0.35,
      )

      // Idle bounce on the launch pad behind the menu
      if (st === "menu") {
        const p = world.player
        p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)
        p.y += p.vy * dt
        const pad = world.platforms[0]
        if (pad && p.vy > 0 && p.y + PLAYER_H >= pad.y) {
          p.y = pad.y - PLAYER_H
          p.vy = -JUMP_V * 0.5
        }
      }

      if (st === "sucked") {
        const p = world.player
        const t = (world.time - world.suckedAt) / SUCK_DURATION
        const pull = Math.min(1, 10 * dt)
        p.x += (world.suckX - PLAYER_W / 2 - p.x) * pull
        p.y += (world.suckY - PLAYER_H / 2 - p.y) * pull
        if (t >= 1) endGame()
      }

      if (st === "playing" || st === "falling") {
        const p = world.player

        // Horizontal control
        let ax = 0
        if (st === "playing") {
          if (keysRef.current.left) ax -= 1
          if (keysRef.current.right) ax += 1
          if (ax === 0 && pointerRef.current.active && pointerRef.current.moved) {
            const delta = pointerRef.current.x - (p.x + PLAYER_W / 2)
            if (Math.abs(delta) > 10) ax = Math.sign(delta)
          }
        }
        if (ax !== 0) {
          p.vx += ax * MOVE_ACCEL * dt
          p.dir = ax < 0 ? "left" : "right"
        } else {
          p.vx *= Math.max(0, 1 - 10 * dt)
          if (Math.abs(p.vx) < 5) p.vx = 0
        }
        p.vx = clamp(p.vx, -MAX_VX, MAX_VX)

        // Gear (propeller hat / jetpack)
        if (p.gear !== "none" && world.time >= p.gearUntil) p.gear = "none"
        const gearActive = st === "playing" && p.gear !== "none"
        const prevBottom = p.y + PLAYER_H

        if (gearActive) p.vy = p.gear === "propeller" ? -PROPELLER_V : -JETPACK_V
        else p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)
        p.x += p.vx * dt
        p.y += p.vy * dt

        // Wrap horizontally like the original
        if (p.x < -PLAYER_W) p.x = width
        else if (p.x > width) p.x = -PLAYER_W

        if (gearActive && p.gear === "jetpack" && Math.random() < 0.8) {
          addParticles(world, p.x + PLAYER_W / 2 - 16, p.y + PLAYER_H - 6, 1, Math.random() < 0.5 ? "#fbbf24" : "#fb923c", 110)
        }

        // Speed streaks when launched hard (springs, jetpack)
        if (st === "playing" && p.vy < -1000 && Math.random() < 0.6) {
          world.particles.push({
            x: p.x + Math.random() * PLAYER_W,
            y: p.y + PLAYER_H,
            vx: 0,
            vy: 240,
            life: 0.3,
            maxLife: 0.3,
            size: 1.5 + Math.random() * 1.5,
            color: "rgba(255,255,255,0.7)",
          })
        }

        if (st === "playing") {
          // Platform landings (swept: did our feet cross the platform top?)
          if (!gearActive && p.vy > 0) {
            const newBottom = p.y + PLAYER_H
            let landed: Platform | null = null
            for (const pl of world.platforms) {
              if (pl.kind === "ghost" && pl.fadingAt > 0) continue
              if (
                prevBottom <= pl.y + 8 &&
                newBottom >= pl.y &&
                p.x + PLAYER_W * 0.25 < pl.x + PLATFORM_W &&
                p.x + PLAYER_W * 0.75 > pl.x
              ) {
                if (!landed || pl.y < landed.y) landed = pl
              }
            }
            if (landed) {
              const hit = landed
              if (hit.kind === "breakable") {
                breakPlatform(world, hit)
                sounds.playBreak()
                // no bounce — you crash straight through
              } else {
                p.y = hit.y - PLAYER_H
                hit.landedAt = world.time
                world.stompChain = 0
                if (hit.kind === "ghost") hit.fadingAt = world.time
                const springX = attachAnchorX(hit)
                const center = p.x + PLAYER_W / 2
                const trampCenter = hit.x + PLATFORM_W / 2
                if (hit.attachment === "trampoline" && Math.abs(center - trampCenter) < 22) {
                  p.vy = -TRAMPOLINE_V
                  hit.sprungAt = world.time
                  sounds.playSpring()
                  addParticles(world, trampCenter, hit.y - 10, 12, "#fca5a5", 240)
                } else if (hit.attachment === "spring" && center > springX - 4 && center < springX + 24) {
                  p.vy = -SPRING_V
                  hit.sprungAt = world.time
                  sounds.playSpring()
                  addParticles(world, springX + 10, hit.y - 8, 8, "#fca5a5", 200)
                } else if (p.shoeJumps > 0) {
                  // Spring shoes: a limited number of extra-high bounces
                  p.shoeJumps -= 1
                  p.vy = -JUMP_V * SHOE_MULT
                  sounds.playJump()
                  addParticles(world, p.x + PLAYER_W / 2, hit.y, 7, "#fda4af", 160)
                } else {
                  p.vy = -JUMP_V
                  sounds.playJump()
                  addParticles(world, p.x + PLAYER_W / 2, hit.y, 4, "#d9f99d", 110)
                }
              }
            }
            if (!landed) {
              // The starting ground is solid until it scrolls off-screen
              const surface = groundSurface(p.x + PLAYER_W / 2, groundY(world, height))
              if (surface < height + 30 && prevBottom <= surface + 8 && newBottom >= surface) {
                p.y = surface - PLAYER_H
                p.vy = -JUMP_V
                world.stompChain = 0
                sounds.playJump()
                addParticles(world, p.x + PLAYER_W / 2, surface, 6, "#a78bfa", 120)
              }
            }
          }

          // Item pickups sitting on platforms (worn/held power-ups)
          for (const pl of world.platforms) {
            const item = pl.attachment
            if (item !== "propeller" && item !== "jetpack" && item !== "shoes" && item !== "shield") continue
            const ix = attachAnchorX(pl)
            const iy = pl.y - 22
            if (p.x < ix + 22 && p.x + PLAYER_W > ix && p.y < iy + 22 && p.y + PLAYER_H > iy) {
              if (item === "propeller" || item === "jetpack") {
                p.gear = item
                p.gearUntil = world.time + (item === "propeller" ? PROPELLER_DURATION : JETPACK_DURATION)
              } else if (item === "shoes") {
                p.shoeJumps = SHOE_JUMPS
              } else {
                p.shieldUntil = world.time + SHIELD_DURATION
              }
              pl.attachment = undefined
              sounds.playCollect()
              addParticles(world, ix + 10, iy + 10, 10, "#fde68a", 200)
            }
          }

          // Gems
          if (world.gems.length > 0) {
            const taken = new Set<number>()
            for (const g of world.gems) {
              if (p.x < g.x + GEM_SIZE && p.x + PLAYER_W > g.x && p.y < g.y + GEM_SIZE && p.y + PLAYER_H > g.y) {
                taken.add(g.id)
                world.bonus += GEM_POINTS
                world.gemsCollected += 1
                addParticles(world, g.x + GEM_SIZE / 2, g.y + GEM_SIZE / 2, 8, "#fde047", 170)
                addPopup(world, g.x + GEM_SIZE / 2, g.y, `+${GEM_POINTS}`, "#fde047")
                sounds.playGem()
              }
            }
            if (taken.size > 0) world.gems = world.gems.filter((g) => !taken.has(g.id))
          }

          // Monsters
          for (const m of world.monsters) {
            if (m.kind === "flyer") {
              m.x += m.vx * dt
              if (m.x < 0) {
                m.x = 0
                m.vx = Math.abs(m.vx)
              } else if (m.x > width - MONSTER_SIZE) {
                m.x = width - MONSTER_SIZE
                m.vx = -Math.abs(m.vx)
              }
            } else if (m.kind === "ufo") {
              m.x = clamp(m.baseX + Math.sin(world.time * 0.9 + m.phase) * 40, 0, width - MONSTER_SIZE)
            }
          }
          // Monster collisions. `wasFalling` is captured before any stomp bounce
          // is applied: otherwise stomping one monster flips vy negative and a
          // second overlapping monster would read as a side-hit and kill you.
          const inset = 7
          const wasFalling = p.vy > 0
          const stomped = new Set<number>()
          let hitByMonster = false
          for (const m of world.monsters) {
            const overlap =
              p.x + inset < m.x + MONSTER_SIZE - inset &&
              p.x + PLAYER_W - inset > m.x + inset &&
              p.y + inset < m.y + MONSTER_SIZE - inset &&
              p.y + PLAYER_H - inset > m.y + inset
            if (!overlap) continue
            const stompedIt = wasFalling && prevBottom <= m.y + 16
            if (gearActive || stompedIt) {
              stomped.add(m.id)
              world.kills += 1
              // Chained stomps (no platform touch in between) multiply the reward
              const chained = stompedIt && !gearActive
              if (chained) world.stompChain += 1
              const points = KILL_POINTS * (chained ? world.stompChain : 1)
              world.bonus += points
              addPopup(
                world,
                m.x + MONSTER_SIZE / 2,
                m.y,
                chained && world.stompChain > 1 ? `+${points} ×${world.stompChain}` : `+${points}`,
                "#93c5fd",
              )
              addParticles(world, m.x + MONSTER_SIZE / 2, m.y + MONSTER_SIZE / 2, 14, "#93c5fd", 240)
              sounds.playStomp()
              shake(world, 0.12, 3)
              if (chained) p.vy = -JUMP_V
            } else if (world.time < p.shieldUntil) {
              // The shield absorbs one hit and takes the monster with it
              p.shieldUntil = 0
              stomped.add(m.id)
              world.kills += 1
              world.bonus += KILL_POINTS
              addPopup(world, m.x + MONSTER_SIZE / 2, m.y, `+${KILL_POINTS}`, "#67e8f9")
              addParticles(world, m.x + MONSTER_SIZE / 2, m.y + MONSTER_SIZE / 2, 16, "#67e8f9", 260)
              sounds.playShieldPop()
              shake(world, 0.15, 4)
            } else {
              hitByMonster = true
              break
            }
          }
          if (stomped.size > 0) world.monsters = world.monsters.filter((m) => !stomped.has(m.id))
          if (hitByMonster) die(world, "Bumped into a monster")

          // Pellets. Collision is swept along the pellet's path: at the 50ms dt
          // cap a pellet travels further than a monster is tall, so a simple
          // point-overlap test would let it tunnel straight through.
          if (stateRef.current === "playing") {
            const deadMonsters = new Set<number>()
            const spentPellets = new Set<number>()
            for (const pe of world.pellets) {
              const fromX = pe.x
              const fromY = pe.y
              pe.x += pe.vx * dt
              pe.y += pe.vy * dt
              // Walk the travelled segment in short steps so a fast (and
              // possibly diagonal) shot cannot skip over a monster.
              const dist = Math.hypot(pe.x - fromX, pe.y - fromY)
              const steps = Math.max(1, Math.ceil(dist / 10))
              for (const m of world.monsters) {
                if (deadMonsters.has(m.id)) continue
                let hit = false
                for (let s = 0; s <= steps && !hit; s++) {
                  const sx = lerp(fromX, pe.x, s / steps)
                  const sy = lerp(fromY, pe.y, s / steps)
                  hit =
                    sx > m.x + 4 && sx < m.x + MONSTER_SIZE - 4 && sy > m.y && sy < m.y + MONSTER_SIZE
                }
                if (hit) {
                  deadMonsters.add(m.id)
                  spentPellets.add(pe.id)
                  world.kills += 1
                  world.bonus += KILL_POINTS
                  addPopup(world, m.x + MONSTER_SIZE / 2, m.y, `+${KILL_POINTS}`, "#fef08a")
                  addParticles(world, m.x + MONSTER_SIZE / 2, m.y + MONSTER_SIZE / 2, 14, "#93c5fd", 240)
                  sounds.playStomp()
                  break
                }
              }
            }
            if (deadMonsters.size > 0) world.monsters = world.monsters.filter((m) => !deadMonsters.has(m.id))
            world.pellets = world.pellets.filter(
              (pe) =>
                pe.y > -40 && pe.y < height + 40 && pe.x > -40 && pe.x < width + 40 && !spentPellets.has(pe.id),
            )

            // Enemy fire: on-screen monsters lob goo at you once you're high
            // enough, more often and faster the deeper you climb
            const d = difficulty(world.totalClimb)
            for (const m of world.monsters) {
              const canFire = world.totalClimb > 6000 && m.y >= 20 && m.y <= height - 40
              if (!canFire) {
                // Hold fire until eligible, then always give a telegraph window
                // first, so a monster scrolling into view can't snipe instantly
                if (m.nextShotAt < world.time + 0.6) m.nextShotAt = world.time + 0.6
                continue
              }
              if (world.enemyShots.length >= 12 || world.time < m.nextShotAt) continue
              m.nextShotAt = world.time + 3.2 - 1.4 * d + Math.random() * 1.8
              const cx = m.x + MONSTER_SIZE / 2
              const cy = m.y + MONSTER_SIZE / 2
              const dx = p.x + PLAYER_W / 2 - cx
              const dy = p.y + PLAYER_H / 2 - cy
              const len = Math.hypot(dx, dy) || 1
              const sp = 230 + 150 * d
              world.enemyShots.push({ id: nextId(), x: cx, y: cy, vx: (dx / len) * sp, vy: (dy / len) * sp })
              sounds.playEnemyShoot()
            }
            for (const es of world.enemyShots) {
              es.x += es.vx * dt
              es.y += es.vy * dt
            }
            for (const es of world.enemyShots) {
              if (
                es.x > p.x + 4 &&
                es.x < p.x + PLAYER_W - 4 &&
                es.y > p.y + 4 &&
                es.y < p.y + PLAYER_H - 4
              ) {
                if (gearActive || world.time < p.shieldUntil) {
                  if (!gearActive) p.shieldUntil = 0
                  world.enemyShots = world.enemyShots.filter((s) => s.id !== es.id)
                  addParticles(world, es.x, es.y, 10, "#67e8f9", 200)
                  sounds.playShieldPop()
                } else {
                  die(world, "Splatted by monster goo")
                }
                break
              }
            }
            world.enemyShots = world.enemyShots.filter(
              (es) => es.x > -40 && es.x < width + 40 && es.y > -40 && es.y < height + 40,
            )

            // Black holes swallow you whole
            for (const hole of world.holes) {
              const dx = p.x + PLAYER_W / 2 - hole.x
              const dy = p.y + PLAYER_H / 2 - hole.y
              if (dx * dx + dy * dy < (hole.r + 10) * (hole.r + 10)) {
                deathCauseRef.current = "Swallowed by a black hole"
                world.suckedAt = world.time
                world.suckX = hole.x
                world.suckY = hole.y
                sounds.playSucked()
                setState("sucked")
                break
              }
            }
          }

          // Camera scroll: push the world down when the player climbs high
          if (stateRef.current === "playing") {
            const threshold = height * 0.4
            if (p.y < threshold) {
              const diff = threshold - p.y
              p.y = threshold
              for (const pl of world.platforms) pl.y += diff
              for (const m of world.monsters) m.y += diff
              for (const hole of world.holes) hole.y += diff
              for (const pe of world.pellets) pe.y += diff
              for (const es of world.enemyShots) es.y += diff
              for (const sh of world.shards) sh.y += diff
              for (const pt of world.particles) pt.y += diff
              for (const g of world.gems) g.y += diff
              for (const pu of world.popups) pu.y += diff
              world.nextSpawnY += diff
              world.totalClimb += diff
            }
            world.score = Math.floor(world.totalClimb / 2) + world.bonus
            const z = zoneIndex(world.totalClimb)
            if (z > world.zone) {
              world.zone = z
              world.zoneBannerAt = world.time
              sounds.playZone()
            }

            // Spawn new rows and drop everything off-screen
            while (world.nextSpawnY > -300) spawnRow(world, width)
            world.platforms = world.platforms.filter((pl) => pl.y < height + 40)
            world.monsters = world.monsters.filter((m) => m.y < height + 80)
            world.holes = world.holes.filter((hole) => hole.y < height + 100)
            world.gems = world.gems.filter((g) => g.y < height + 40)

            // Fell off the bottom
            if (p.y > height + 20) {
              deathCauseRef.current = "Took a long fall"
              endGame()
            }
          }
        } else if (st === "falling" && p.y > height + 250) {
          endGame()
        }
      }
    }

    draw(canvas, world, height, width)
  }
  useEffect(() => {
    tickRef.current = tick
  })

  // Single persistent animation loop
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      tickRef.current(dt)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ------------------------------------------------------------------- draw
  const draw = (canvas: HTMLCanvasElement, world: World, height: number, width: number) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const { dpr } = sizeRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Night sky that deepens as you climb
    const { top, bottom } = skyColors(world.totalClimb)
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, top)
    sky.addColorStop(1, bottom)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)

    // Nebula washes, parallax-scrolling slower than the world
    const nSpan = height + 400
    for (let i = 0; i < NEBULAS.length; i++) {
      const n = NEBULAS[i]
      const ny = ((((n.fy * nSpan + world.totalClimb * 0.03) % nSpan) + nSpan) % nSpan) - 200
      const nx = n.fx * width + Math.sin(world.time * 0.06 + i * 2.1) * 25
      const nr = n.r * width
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr)
      g.addColorStop(0, `rgba(${n.color},0.13)`)
      g.addColorStop(1, `rgba(${n.color},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(nx, ny, nr, 0, Math.PI * 2)
      ctx.fill()
    }

    // Stars: brighter and denser-feeling the higher you go
    const starA = 0.3 + 0.7 * clamp(world.totalClimb / 14000, 0, 1)
    const starSpan = height + 80
    for (const s of STARS) {
      const sy = ((((s.fy * starSpan + world.totalClimb * 0.06) % starSpan) + starSpan) % starSpan) - 40
      const twinkle = 0.5 + 0.5 * Math.sin(world.time * s.tw + s.fx * 12)
      ctx.fillStyle = `rgba(255,255,255,${(starA * twinkle).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(s.fx * width, sy, s.size, 0, Math.PI * 2)
      ctx.fill()
    }

    // Fireflies drift near the ground, fading out with altitude
    const fireflyA = 1 - clamp((world.totalClimb - 5000) / 3000, 0, 1)
    if (fireflyA > 0.02) {
      const fSpan = height + 60
      for (const f of FIREFLIES) {
        const fx = f.fx * width + Math.sin(world.time * f.sp + f.ph) * 30
        const fy = ((((f.fy * fSpan + world.totalClimb * 0.18) % fSpan) + fSpan) % fSpan) - 30
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(world.time * f.sp * 3 + f.ph))
        ctx.save()
        ctx.shadowColor = "rgba(190,242,100,0.9)"
        ctx.shadowBlur = 10
        ctx.fillStyle = `rgba(217,249,157,${(fireflyA * pulse).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(fx, fy, f.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // Shooting stars once you're up in the dark sky. Each time slot gets a
    // deterministic streak, so no state needs storing between frames.
    if (world.totalClimb > 9000) {
      const period = 3.3
      const slot = Math.floor(world.time / period)
      const t = (world.time - slot * period) / 0.65
      if (t < 1) {
        const rnd = mulberry32(slot * 7919 + 13)
        const sx = rnd() * width * 0.8 + width * 0.1
        const sy = rnd() * height * 0.45
        const len = 140 + rnd() * 120
        const hx = sx + t * len
        const hy = sy + t * len * 0.45
        const a = Math.sin(t * Math.PI) * clamp((world.totalClimb - 9000) / 4000, 0, 1)
        const g = ctx.createLinearGradient(hx - 70, hy - 31, hx, hy)
        g.addColorStop(0, "rgba(255,255,255,0)")
        g.addColorStop(1, `rgba(255,255,255,${(0.85 * a).toFixed(3)})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 2
        ctx.lineCap = "round"
        ctx.beginPath()
        ctx.moveTo(hx - 70, hy - 31)
        ctx.lineTo(hx, hy)
        ctx.stroke()
        ctx.lineCap = "butt"
      }
    }

    // Camera shake (skipped when the OS asks for reduced motion)
    ctx.save()
    if (world.time < world.shakeUntil && !reducedMotionRef.current) {
      const k = clamp((world.shakeUntil - world.time) / 0.3, 0, 1)
      const m = world.shakeMag * k
      ctx.translate(Math.sin(world.time * 80) * m, Math.cos(world.time * 67) * m * 0.8)
    }

    drawGround(ctx, groundY(world, height), width, height, world.totalClimb, world.time)

    // Personal-best marker: the altitude you need to pass to beat your record.
    // The world scrolls down as totalClimb rises, so the line drifts toward the
    // player and meets them exactly when they tie their highest climb.
    const bestClimb = bestHeightRef.current
    if (bestClimb > 0 && stateRef.current !== "menu") {
      const markerY = height * 0.4 + (world.totalClimb - bestClimb)
      if (markerY > HUD_H + 8 && markerY < height) {
        ctx.save()
        ctx.strokeStyle = "rgba(251,191,36,0.75)"
        ctx.lineWidth = 2
        ctx.setLineDash([9, 7])
        ctx.beginPath()
        ctx.moveTo(0, markerY)
        ctx.lineTo(width, markerY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.font = `600 11px ${GAME_FONT}`
        ctx.fillStyle = "rgba(251,191,36,0.95)"
        ctx.textAlign = "right"
        ctx.textBaseline = "bottom"
        ctx.fillText("YOUR BEST", width - 10, markerY - 4)
        ctx.textAlign = "left"
        ctx.textBaseline = "alphabetic"
        ctx.restore()
      }
    }

    for (const hole of world.holes) drawBlackHole(ctx, hole, world.time)
    for (const pl of world.platforms) drawPlatform(ctx, pl, world.time, dpr)
    for (const g of world.gems) drawGem(ctx, g, world.time)

    // Shards from broken platforms
    for (const sh of world.shards) {
      ctx.save()
      ctx.translate(sh.x + PLATFORM_W / 4, sh.y + PLATFORM_H / 2)
      ctx.rotate(sh.rot)
      ctx.fillStyle = PLATFORM_STYLE.breakable.fill
      ctx.strokeStyle = PLATFORM_STYLE.breakable.stroke
      ctx.lineWidth = 2
      rr(ctx, -PLATFORM_W / 4, -PLATFORM_H / 2, PLATFORM_W / 2, PLATFORM_H, 6)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    const firing = world.totalClimb > 6000 && stateRef.current === "playing"
    for (const m of world.monsters) {
      const onScreen = m.y >= 20 && m.y <= height - 40
      const charge = firing && onScreen ? clamp(1 - (m.nextShotAt - world.time) / 0.5, 0, 1) : 0
      drawMonster(ctx, m, world.time, charge)
    }

    // Enemy goo
    for (const es of world.enemyShots) {
      const pulse = 0.85 + 0.15 * Math.sin(world.time * 10 + es.id)
      ctx.save()
      ctx.shadowColor = "rgba(217,70,239,0.9)"
      ctx.shadowBlur = 8
      ctx.fillStyle = "#e879f9"
      ctx.beginPath()
      ctx.arc(es.x, es.y, 5.5 * pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = "#701a75"
      ctx.beginPath()
      ctx.arc(es.x, es.y, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Pellets
    ctx.save()
    ctx.shadowColor = "rgba(254,240,138,0.9)"
    ctx.shadowBlur = 8
    ctx.fillStyle = "#fef08a"
    for (const pe of world.pellets) {
      ctx.beginPath()
      ctx.arc(pe.x, pe.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // Particles
    for (const pt of world.particles) {
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1)
      ctx.fillStyle = pt.color
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    drawPlayer(ctx, world)

    // Floating score popups
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.font = `700 18px ${GAME_FONT}`
    ctx.lineJoin = "round"
    for (const pu of world.popups) {
      const a = clamp(pu.life / 0.35, 0, 1)
      const pop = 1 + 0.25 * clamp((pu.life - 0.75) / 0.15, 0, 1)
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(pu.x, pu.y)
      ctx.scale(pop, pop)
      ctx.lineWidth = 4
      ctx.strokeStyle = "rgba(15,10,40,0.8)"
      ctx.strokeText(pu.text, 0, 0)
      ctx.fillStyle = pu.color
      ctx.fillText(pu.text, 0, 0)
      ctx.restore()
    }
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.restore()

    // Vignette, rebuilt only when the canvas size changes
    const vig = vignetteRef.current
    if (!vig.grad || vig.w !== width || vig.h !== height) {
      const g = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.hypot(width, height) * 0.6,
      )
      g.addColorStop(0, "rgba(5,3,20,0)")
      g.addColorStop(1, "rgba(5,3,20,0.55)")
      vignetteRef.current = { w: width, h: height, grad: g }
    }
    ctx.fillStyle = vignetteRef.current.grad as CanvasGradient
    ctx.fillRect(0, 0, width, height)

    // Death flash
    if (world.time < world.flashUntil) {
      ctx.fillStyle = `rgba(255,255,255,${(((world.flashUntil - world.time) / 0.18) * 0.45).toFixed(3)})`
      ctx.fillRect(0, 0, width, height)
    }

    if (stateRef.current !== "menu") {
      drawZoneBanner(ctx, world, width, height)
      drawHud(ctx, world, width)
    }
  }

  const drawZoneBanner = (ctx: CanvasRenderingContext2D, world: World, width: number, height: number) => {
    const t = world.time - world.zoneBannerAt
    const DURATION = 2.6
    if (t < 0 || t > DURATION) return
    const a = Math.min(clamp(t / 0.3, 0, 1), clamp((DURATION - t) / 0.5, 0, 1))
    const slide = (1 - clamp(t / 0.35, 0, 1)) * -14
    const cy = height * 0.24 + slide
    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.font = `600 14px ${GAME_FONT}`
    ctx.fillStyle = "rgba(255,255,255,0.7)"
    const label = `ZONE ${world.zone + 1}`
    // Manual letter-spacing: canvas letterSpacing isn't available everywhere
    const spaced = label.split("").join(String.fromCharCode(8202))
    ctx.fillText(spaced, width / 2, cy - 26)
    ctx.font = `700 44px ${GAME_FONT}`
    const name = ZONES[world.zone].name
    const tw = ctx.measureText(name).width
    const grad = ctx.createLinearGradient(width / 2 - tw / 2, 0, width / 2 + tw / 2, 0)
    grad.addColorStop(0, "#bef264")
    grad.addColorStop(0.5, "#6ee7b7")
    grad.addColorStop(1, "#67e8f9")
    ctx.lineJoin = "round"
    ctx.lineWidth = 7
    ctx.strokeStyle = "rgba(15,10,40,0.65)"
    ctx.strokeText(name, width / 2, cy + 10)
    ctx.fillStyle = grad
    ctx.fillText(name, width / 2, cy + 10)
    ctx.restore()
  }

  const drawPlayer = (ctx: CanvasRenderingContext2D, world: World) => {
    const p = world.player
    const st = stateRef.current
    const dead = st === "falling"
    const shooting = world.time < p.shootUntil + 0.1
    // Keyed to the world flag, not the transient "sucked" state, so the player
    // stays swallowed once the game-over card appears instead of popping back.
    const consumed = world.suckedAt > 0
    let scale = 1
    if (consumed) scale = clamp(1 - (world.time - world.suckedAt) / SUCK_DURATION, 0, 1)
    if (scale <= 0) return

    ctx.save()
    ctx.translate(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2)
    if (dead) ctx.rotate((world.time - world.fellAt) * 6)
    if (consumed) ctx.rotate((world.time - world.suckedAt) * 10)
    const stretch = clamp(1 - p.vy / 2800, 0.85, 1.15)
    const flip = p.dir === "left" ? -1 : 1
    ctx.scale((flip * scale) / Math.sqrt(stretch), stretch * scale)

    // Jetpack worn on the back
    if (p.gear === "jetpack" && st === "playing") {
      ctx.fillStyle = "#cbd5e1"
      ctx.strokeStyle = "#64748b"
      ctx.lineWidth = 2
      rr(ctx, -PLAYER_W / 2 - 8, -12, 12, 26, 5)
      ctx.fill()
      ctx.stroke()
      const flame = 10 + Math.sin(world.time * 30) * 5
      ctx.fillStyle = "#fbbf24"
      ctx.beginPath()
      ctx.moveTo(-PLAYER_W / 2 - 7, 14)
      ctx.lineTo(-PLAYER_W / 2 - 2, 14 + flame)
      ctx.lineTo(-PLAYER_W / 2 + 3, 14)
      ctx.closePath()
      ctx.fill()
    }

    const bodyRy = PLAYER_H / 2 - 3

    // Spring shoes strapped under the feet
    if (p.shoeJumps > 0 && st === "playing") {
      ctx.strokeStyle = "#94a3b8"
      ctx.lineWidth = 1.8
      for (const fx of [-10, 10]) {
        ctx.beginPath()
        ctx.moveTo(fx - 4, PLAYER_H / 2 + 2)
        ctx.lineTo(fx + 4, PLAYER_H / 2 + 5)
        ctx.moveTo(fx - 4, PLAYER_H / 2 + 5)
        ctx.lineTo(fx + 4, PLAYER_H / 2 + 8)
        ctx.stroke()
      }
      ctx.fillStyle = "#f43f5e"
      ctx.strokeStyle = "#9f1239"
      for (const fx of [-10, 10]) {
        rr(ctx, fx - 6, PLAYER_H / 2 - 4, 12, 6, 3)
        ctx.fill()
        ctx.stroke()
      }
    }

    // The player's chosen monster
    drawAvatarBody(ctx, avatarRef.current, {
      time: world.time,
      shooting: shooting && st === "playing",
      dead: dead || consumed,
    })

    // Propeller hat spins on the head
    if (p.gear === "propeller" && st === "playing") {
      ctx.fillStyle = "#f4b93c"
      ctx.strokeStyle = "#a16207"
      ctx.lineWidth = 2
      rr(ctx, -12, -bodyRy - 9, 24, 9, 4)
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = "#57534e"
      ctx.beginPath()
      ctx.moveTo(0, -bodyRy - 9)
      ctx.lineTo(0, -bodyRy - 15)
      ctx.stroke()
      const spin = Math.sin(world.time * 35)
      ctx.fillStyle = "#e7e5e4"
      ctx.strokeStyle = "#78716c"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(0, -bodyRy - 16, Math.max(3, Math.abs(spin) * 18), 3, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()

    // Shield bubble, drawn unmirrored around the player; blinks when expiring
    if (world.time < p.shieldUntil && st !== "menu") {
      const remaining = p.shieldUntil - world.time
      const pulse = remaining < 2 ? 0.3 + 0.4 * Math.abs(Math.sin(world.time * 8)) : 0.6
      const cx = p.x + PLAYER_W / 2
      const cy = p.y + PLAYER_H / 2
      ctx.strokeStyle = `rgba(34,211,238,${pulse.toFixed(3)})`
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(cx, cy, PLAYER_W * 0.72, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = "rgba(103,232,249,0.1)"
      ctx.fill()
    }
  }

  const drawHud = (ctx: CanvasRenderingContext2D, world: World, width: number) => {
    ctx.save()
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"

    // Score panel: score on top, height and zone underneath
    const scoreText = world.score.toLocaleString()
    const subText = `${Math.floor(world.totalClimb / 10).toLocaleString()} m · ${ZONES[world.zone].name}`
    ctx.font = `700 30px ${GAME_FONT}`
    const scoreW = ctx.measureText(scoreText).width
    ctx.font = `500 12px ${GAME_FONT}`
    const subW = ctx.measureText(subText).width
    const panelW = Math.max(scoreW, subW) + 32
    ctx.fillStyle = "rgba(15,10,40,0.62)"
    rr(ctx, 12, 10, panelW, 60, 16)
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.12)"
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.font = `700 30px ${GAME_FONT}`
    ctx.fillStyle = "#ffffff"
    ctx.fillText(scoreText, 28, 44)
    ctx.font = `500 12px ${GAME_FONT}`
    ctx.fillStyle = "rgba(255,255,255,0.62)"
    ctx.fillText(subText, 28, 61)

    // Best pill, left of the mute/pause buttons (hidden until a record exists)
    const beatingBest = highScoreRef.current > 0 && world.score > highScoreRef.current
    const bestText = beatingBest ? "NEW BEST ★" : `BEST ${Math.max(highScoreRef.current, world.score).toLocaleString()}`
    if (highScoreRef.current > 0) {
      ctx.font = `600 12px ${GAME_FONT}`
      const bestW = ctx.measureText(bestText).width + 22
      const bx = width - 96 - bestW
      ctx.fillStyle = beatingBest ? "rgba(251,191,36,0.92)" : "rgba(15,10,40,0.62)"
      rr(ctx, bx, 14, bestW, 26, 13)
      ctx.fill()
      if (!beatingBest) {
        ctx.strokeStyle = "rgba(255,255,255,0.12)"
        ctx.stroke()
      }
      ctx.fillStyle = beatingBest ? "#451a03" : "rgba(255,255,255,0.75)"
      ctx.fillText(bestText, bx + 11, 31)
    }

    // Active power-ups as labelled chips with a draining bar
    const p = world.player
    if (stateRef.current === "playing") {
      let chipY = 78
      const chip = (label: string, frac: number, color: string) => {
        ctx.fillStyle = "rgba(15,10,40,0.55)"
        rr(ctx, 12, chipY, 140, 26, 13)
        ctx.fill()
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(26, chipY + 13, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.font = `600 11px ${GAME_FONT}`
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        ctx.fillText(label, 37, chipY + 12)
        ctx.fillStyle = "rgba(255,255,255,0.15)"
        rr(ctx, 37, chipY + 17, 104, 4, 2)
        ctx.fill()
        ctx.fillStyle = color
        rr(ctx, 37, chipY + 17, 104 * clamp(frac, 0, 1), 4, 2)
        ctx.fill()
        chipY += 32
      }
      if (p.gear !== "none") {
        const total = p.gear === "propeller" ? PROPELLER_DURATION : JETPACK_DURATION
        chip(
          p.gear === "propeller" ? "Propeller" : "Jetpack",
          (p.gearUntil - world.time) / total,
          p.gear === "propeller" ? "#facc15" : "#fb923c",
        )
      }
      if (world.time < p.shieldUntil) chip("Shield", (p.shieldUntil - world.time) / SHIELD_DURATION, "#22d3ee")
      if (p.shoeJumps > 0) chip(`Spring shoes ×${p.shoeJumps}`, p.shoeJumps / SHOE_JUMPS, "#f43f5e")
    }
    ctx.restore()
  }

  // ------------------------------------------------------------------ input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = stateRef.current
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keysRef.current.left = true
        e.preventDefault()
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keysRef.current.right = true
        e.preventDefault()
      } else if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === "Enter") {
        e.preventDefault()
        if (st === "menu" || st === "gameOver") startGameRef.current()
        else if (st === "playing") shoot()
      } else if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        if (st === "playing") setState("paused")
        else if (st === "paused") setState("playing")
        else if (st === "gameOver" && e.key === "Escape") goToMenuRef.current()
      } else if (e.key === "r" || e.key === "R") {
        if (st !== "menu") startGameRef.current()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keysRef.current.left = false
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keysRef.current.right = false
    }
    const onBlur = () => {
      keysRef.current.left = false
      keysRef.current.right = false
      pointerRef.current.active = false
      if (stateRef.current === "playing") setState("paused")
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onBlur()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [setState, shoot])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerRef.current = {
      active: true,
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      downX: e.nativeEvent.offsetX,
      downAt: performance.now(),
      moved: false,
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ptr = pointerRef.current
    if (!ptr.active) return
    ptr.x = e.nativeEvent.offsetX
    ptr.y = e.nativeEvent.offsetY
    if (Math.abs(ptr.x - ptr.downX) > 12) ptr.moved = true
  }
  const onPointerEnd = () => {
    const ptr = pointerRef.current
    // A quick tap that didn't drag is a shot, aimed at where you tapped
    if (ptr.active && !ptr.moved && performance.now() - ptr.downAt < 300) shoot({ x: ptr.x, y: ptr.y })
    ptr.active = false
  }

  // ---------------------------------------------------------------- actions
  const startGame = useCallback(() => {
    sounds.ensureAudio()
    const { w, h } = sizeRef.current
    const world = createWorld(w, h)
    world.zoneBannerAt = 0.35
    worldRef.current = world
    deathCauseRef.current = ""
    keysRef.current = { left: false, right: false }
    pointerRef.current.active = false
    setState("playing")
  }, [setState, sounds])
  const startGameRef = useRef(startGame)
  useEffect(() => {
    startGameRef.current = startGame
  }, [startGame])

  const goToMenu = useCallback(() => {
    const { w, h } = sizeRef.current
    worldRef.current = createWorld(w, h)
    setState("menu")
  }, [setState])
  const goToMenuRef = useRef(goToMenu)
  useEffect(() => {
    goToMenuRef.current = goToMenu
  }, [goToMenu])

  // Game-over score counts up instead of just appearing
  useEffect(() => {
    if (gameState !== "gameOver") return
    const target = finalStats.score
    if (reducedMotionRef.current || target === 0) {
      setShownScore(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = clamp((now - start) / 900, 0, 1)
      setShownScore(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [gameState, finalStats.score])

  // ----------------------------------------------------------------- render
  const iconBtn =
    "h-9 w-9 rounded-full border border-white/15 bg-[#0f0a28]/55 text-white shadow-sm backdrop-blur hover:bg-white/20 hover:text-white"
  const card =
    "w-full rounded-[28px] border border-white/15 bg-[#1b1442]/85 text-center text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-300"
  const primaryBtn =
    "h-auto w-full rounded-2xl border-b-4 border-emerald-700 bg-gradient-to-b from-emerald-400 to-emerald-500 py-4 text-xl font-semibold text-emerald-950 shadow-[0_8px_30px_rgba(52,211,153,0.35)] transition-transform hover:scale-[1.02] hover:from-emerald-300 hover:to-emerald-400 active:translate-y-0.5 active:border-b-2"
  const secondaryBtn =
    "h-auto w-full rounded-2xl bg-white/10 py-3.5 text-base font-semibold text-white hover:bg-white/20 hover:text-white"

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0b0820] select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
      />

      {/* Top-right controls */}
      <div className="absolute right-3 top-3 flex gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={isMuted ? "Unmute" : "Mute"}
          className={iconBtn}
          onClick={() => {
            sounds.ensureAudio()
            setIsMuted((m) => !m)
          }}
        >
          {isMuted ? <VolumeXIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
        </Button>
        {(gameState === "playing" || gameState === "paused") && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={gameState === "playing" ? "Pause" : "Resume"}
            className={iconBtn}
            onClick={() => setState(gameState === "playing" ? "paused" : "playing")}
          >
            {gameState === "playing" ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {/* Menu */}
      {gameState === "menu" && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_center,rgba(11,8,32,0.15),rgba(11,8,32,0.6))] p-4">
          <div className={`${card} max-w-[420px] px-7 pb-6 pt-7`}>
            <h1 className="text-[56px] font-bold leading-[0.95] tracking-tight drop-shadow-[0_4px_0_rgba(15,10,40,0.6)]">
              <span className="bg-gradient-to-r from-lime-300 via-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                Monster
              </span>{" "}
              <span className="text-white">Hop</span>
            </h1>
            <p className="mt-2 text-[15px] font-medium text-white/60">Bounce through the night. Don&apos;t look down.</p>

            {/* Selected monster showcase */}
            <div className="mx-auto mt-5 flex items-center justify-center gap-4 rounded-3xl bg-white/[0.06] px-4 py-3">
              <div className="rounded-2xl bg-[radial-gradient(circle,rgba(167,139,250,0.35),transparent_70%)]">
                <AvatarPreview id={avatar} size={84} animate />
              </div>
              <div className="text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Your monster</p>
                <p className="text-2xl font-bold leading-tight text-emerald-300">{AVATAR_NAMES[avatar]}</p>
                <p className="text-sm text-white/60">{AVATAR_TAGLINES[avatar]}</p>
              </div>
            </div>

            {/* Picker */}
            <div className="mt-3 flex justify-center gap-2" role="radiogroup" aria-label="Choose your monster">
              {AVATAR_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={avatar === id}
                  aria-label={AVATAR_NAMES[id]}
                  onClick={() => setAvatar(id)}
                  className={`rounded-2xl border-2 p-0.5 transition-all duration-150 ${
                    avatar === id
                      ? "-translate-y-0.5 border-emerald-400 bg-emerald-400/15 shadow-[0_0_16px_rgba(52,211,153,0.45)]"
                      : "border-white/10 bg-white/5 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/10"
                  }`}
                >
                  <AvatarPreview id={id} size={50} />
                </button>
              ))}
            </div>

            <Button onClick={startGame} className={`${primaryBtn} mt-5`}>
              Play
              <Kbd className="ml-2 border-emerald-900/30 bg-emerald-900/15 text-emerald-950/70">Enter</Kbd>
            </Button>

            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              {highScore > 0 ? (
                <span className="rounded-full bg-amber-400/15 px-3 py-1 font-semibold text-amber-300">
                  🏆 Best {highScore.toLocaleString()}
                </span>
              ) : (
                <span className="text-white/45">No best yet — go set one!</span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-left text-[13px] text-white/60">
              <span className="flex items-center gap-1.5">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> Move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Space</Kbd> Shoot up
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Click</Kbd> Aimed shot
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>P</Kbd> Pause
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Paused */}
      {gameState === "paused" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b0820]/55 p-4 backdrop-blur-sm">
          <div className={`${card} max-w-[320px] p-7`}>
            <h2 className="text-4xl font-bold">Paused</h2>
            <p className="mt-1 text-white/60">
              {(worldRef.current?.score ?? 0).toLocaleString()} pts · {ZONES[worldRef.current?.zone ?? 0].name}
            </p>
            <div className="mt-6 space-y-2.5">
              <Button onClick={() => setState("playing")} className={primaryBtn}>
                <PlayIcon className="mr-2 h-5 w-5" /> Resume
                <Kbd className="ml-2 border-emerald-900/30 bg-emerald-900/15 text-emerald-950/70">Esc</Kbd>
              </Button>
              <Button onClick={startGame} className={secondaryBtn}>
                <RotateCcwIcon className="mr-2 h-4 w-4" /> Restart <Kbd className="ml-2">R</Kbd>
              </Button>
              <Button onClick={goToMenu} variant="ghost" className={`${secondaryBtn} bg-transparent text-white/60`}>
                <HomeIcon className="mr-2 h-4 w-4" /> Main menu
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Game over */}
      {gameState === "gameOver" && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[#0b0820]/55 p-4 backdrop-blur-sm">
          <div className={`${card} relative max-w-[380px] overflow-hidden p-7`}>
            {finalStats.isNewBest && (
              <div className="absolute -right-12 top-6 rotate-45 bg-amber-400 px-12 py-1 text-xs font-bold uppercase tracking-wider text-amber-950 shadow">
                New best!
              </div>
            )}
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-300/80">Game over</p>
            <h2 className="mt-1 text-2xl font-bold text-white/90">{finalStats.cause}</h2>
            <div className="my-4 text-7xl font-bold tabular-nums text-emerald-300 drop-shadow-[0_0_24px_rgba(52,211,153,0.45)]">
              {shownScore.toLocaleString()}
            </div>
            <p className="-mt-2 mb-5 text-sm text-white/50">
              Reached <span className="font-semibold text-white/80">{ZONES[finalStats.zone].name}</span>
            </p>
            <div className="mb-6 grid grid-cols-2 gap-2">
              {[
                { label: "Height", value: `${finalStats.height.toLocaleString()} m` },
                { label: "Best", value: highScore.toLocaleString() },
                { label: "Monsters", value: finalStats.kills.toLocaleString() },
                { label: "Gems", value: finalStats.gems.toLocaleString() },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-white/[0.07] px-3 py-2.5">
                  <div className="text-xl font-bold tabular-nums">{stat.value}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2.5">
              <Button onClick={startGame} className={primaryBtn}>
                Play again
                <Kbd className="ml-2 border-emerald-900/30 bg-emerald-900/15 text-emerald-950/70">Enter</Kbd>
              </Button>
              <Button onClick={goToMenu} variant="ghost" className={`${secondaryBtn} bg-transparent text-white/60`}>
                <HomeIcon className="mr-2 h-4 w-4" /> Main menu <Kbd className="ml-2">Esc</Kbd>
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 font-[inherit] text-[11px] font-semibold leading-none text-white/80 shadow-[inset_0_-2px_0_rgba(255,255,255,0.1)] ${className}`}
    >
      {children}
    </kbd>
  )
}
