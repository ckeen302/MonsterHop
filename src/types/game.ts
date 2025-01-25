export type PlatformType = "normal" | "moving" | "breakable" | "boost"
export type ObstacleType = "spike" | "saw"
export type PowerUpType = "jetpack" | "shield"
export type GameState = "menu" | "playing" | "paused" | "gameOver" | "falling"

export interface Platform {
  id: string
  x: number
  y: number
  type: PlatformType
}

export interface Obstacle {
  id: string
  x: number
  y: number
  type: ObstacleType
}

export interface PowerUp {
  id: string
  x: number
  y: number
  type: PowerUpType
}

