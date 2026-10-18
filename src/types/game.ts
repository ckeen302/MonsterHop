export type PlatformKind = "green" | "moving" | "breakable" | "ghost"
export type Attachment = "spring" | "trampoline" | "propeller" | "jetpack" | "shoes" | "shield"
export type MonsterKind = "blob" | "flyer" | "ufo"
export type Gear = "none" | "propeller" | "jetpack"
export type AvatarId = "gloop" | "batty" | "ember" | "squiddy" | "boo"
export type GameState = "menu" | "playing" | "paused" | "falling" | "sucked" | "gameOver"

export interface Platform {
  id: number
  x: number
  y: number
  kind: PlatformKind
  // Movement parameters for "moving" platforms
  baseX: number
  phase: number
  speed: number
  amp: number
  // Optional item sitting on the platform
  attachment?: Attachment
  attachSide: number // -1 (left end) or 1 (right end)
  sprungAt: number // when the spring was last used (animation)
  fadingAt: number // ghost platforms: when the single bounce consumed it (0 = unused)
  landedAt: number // last time the player bounced off it (drives the dip animation)
}

export interface MonsterEntity {
  id: number
  x: number
  y: number
  baseX: number
  kind: MonsterKind
  vx: number
  phase: number
  nextShotAt: number
}

export interface EnemyShot {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

export interface BlackHole {
  id: number
  x: number
  y: number
  r: number
}

export interface Pellet {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

export interface Shard {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  flip: boolean
}

export interface Gem {
  id: number
  x: number
  y: number
  phase: number
}

export interface Popup {
  x: number
  y: number
  text: string
  color: string
  life: number
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
}

export interface Player {
  x: number
  y: number
  vx: number
  vy: number
  dir: "left" | "right"
  gear: Gear
  gearUntil: number
  shootUntil: number
  shoeJumps: number
  shieldUntil: number
}

export interface World {
  player: Player
  platforms: Platform[]
  monsters: MonsterEntity[]
  holes: BlackHole[]
  pellets: Pellet[]
  enemyShots: EnemyShot[]
  shards: Shard[]
  particles: Particle[]
  gems: Gem[]
  popups: Popup[]
  time: number
  nextSpawnY: number
  lastMainX: number
  totalClimb: number
  score: number
  bonus: number
  kills: number
  gemsCollected: number
  stompChain: number
  zone: number
  zoneBannerAt: number
  fellAt: number
  suckedAt: number
  suckX: number
  suckY: number
  shakeUntil: number
  shakeMag: number
  flashUntil: number
}
