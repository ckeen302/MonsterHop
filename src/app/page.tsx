"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence, useSpring } from "framer-motion"
import { Button } from "../components/ui/button"
import { PauseIcon, PlayIcon } from "lucide-react"
import { useSound } from "use-sound"
import {
  type Platform as PlatformType,
  type Obstacle as ObstacleType,
  type PowerUp,
  type GameState as GameStateType,
  type PlatformType as PlatformVariant,
  type ObstacleType as ObstacleVariant,
  type PowerUpType,
} from "../types/game"
import { Monster } from "../components/Monster"
import { useSoundEffects } from "../hooks/useSoundEffects"
import { SoundSettings } from "../components/SoundSettings"

let idCounter = 0
const generateUniqueId = () => {
  idCounter += 1
  return `${Date.now()}-${idCounter}`
}

// Constants based on real-world physics (scaled for gameplay)
const GRAVITY = 0.4
const JUMP_VELOCITY = 13
const MOVE_ACCELERATION = 0.8
const MAX_VELOCITY = 10
const FRICTION = 0.92
const PLAYER_SIZE = 40
const PLATFORM_WIDTH = 60
const PLATFORM_HEIGHT = 15
const INITIAL_PLATFORM_COUNT = 30
const INITIAL_PLATFORM_SPACING = 30
const MAX_PLATFORM_SPACING = 200
const DIFFICULTY_INCREASE_RATE = 0.0001
const BOOST_VELOCITY = 20
const OBSTACLE_SIZE = 30
const POWER_UP_SIZE = 30
const JETPACK_DURATION = 5000
const SHIELD_DURATION = 10000
const COMBO_TIMEOUT = 1000

// Game area divisions for difficulty progression
const EASY_ZONE = 5000
const MEDIUM_ZONE = 15000

type PlatformKind = "normal" | "moving" | "breakable" | "boost"
type ObstacleKind = "spike" | "saw"
type MonsterType = "green" | "blue" | "red"

interface Platform {
  id: number | string
  x: number
  y: number
  type: PlatformKind
}

interface Obstacle {
  id: number | string
  x: number
  y: number
  type: ObstacleKind
}

interface Monster {
  id: string
  x: number
  y: number
  type: MonsterType
}

type GameState = "menu" | "playing" | "paused" | "gameOver" | "falling"

export default function DoodleJump() {
  const [gameState, setGameState] = useState<GameState>("menu")
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [playerX, setPlayerX] = useState(0)
  const [playerY, setPlayerY] = useState(0)
  const [playerVelocityY, setPlayerVelocityY] = useState(0)
  const [playerVelocityX, setPlayerVelocityX] = useState(0)
  const [playerDirection, setPlayerDirection] = useState<"left" | "right">("right")
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [gameTime, setGameTime] = useState(0)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [activeJetpack, setActiveJetpack] = useState(false)
  const [activeShield, setActiveShield] = useState(false)
  const [combo, setCombo] = useState(0)
  const [lastPlatformJump, setLastPlatformJump] = useState(0)
  const [particles, setParticles] = useState<
    { id: string; x: number; y: number; vx: number; vy: number; color: string }[]
  >([])
  const [monsters, setMonsters] = useState<Monster[]>([])
  const [isMuted, setIsMuted] = useState(false)
  const gameRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<number>()
  const previousTimeRef = useRef<number>()
  const keysPressed = useRef<{ [key: string]: boolean }>({})

  const springX = useSpring(0, { stiffness: 300, damping: 20 })
  const springY = useSpring(0, { stiffness: 300, damping: 20 })

  const { playJump, playCollect, playHit, playGameOver, playBackgroundMusic, stopBackgroundMusic } = useSoundEffects()

  useEffect(() => {
    const updateDimensions = () => {
      if (gameRef.current) {
        const { width, height } = gameRef.current.getBoundingClientRect()
        setDimensions({ width, height })
      }
    }

    updateDimensions()
    window.addEventListener("resize", updateDimensions)
    return () => window.removeEventListener("resize", updateDimensions)
  }, [])

  useEffect(() => {
    if (gameState === "playing" && !isMuted) {
      playBackgroundMusic()
    } else {
      stopBackgroundMusic()
    }
  }, [gameState, isMuted, playBackgroundMusic, stopBackgroundMusic])

  const calculateDifficulty = (height: number) => {
    if (height < EASY_ZONE) {
      return 0
    } else if (height < MEDIUM_ZONE) {
      return (height - EASY_ZONE) / (MEDIUM_ZONE - EASY_ZONE)
    } else {
      return 1 + (height - MEDIUM_ZONE) * DIFFICULTY_INCREASE_RATE
    }
  }

  const initializePlatforms = () => {
    const newPlatforms: Platform[] = []
    let y = dimensions.height - INITIAL_PLATFORM_SPACING

    for (let i = 0; i < INITIAL_PLATFORM_COUNT; i++) {
      newPlatforms.push({
        id: generateUniqueId(),
        x: Math.random() * (dimensions.width - PLATFORM_WIDTH),
        y: y,
        type: "normal",
      })
      y -= INITIAL_PLATFORM_SPACING
    }
    return newPlatforms
  }

  const generatePlatform = (yPosition: number): Platform => {
    const difficulty = calculateDifficulty(yPosition)
    const platformSpacing = INITIAL_PLATFORM_SPACING + (MAX_PLATFORM_SPACING - INITIAL_PLATFORM_SPACING) * difficulty

    const platformType = (): PlatformKind => {
      const rand = Math.random()
      if (rand < 0.6 - 0.2 * difficulty) return "normal"
      if (rand < 0.8 - 0.2 * difficulty) return "moving"
      if (rand < 0.9 - 0.1 * difficulty) return "breakable"
      return "boost"
    }

    return {
      id: generateUniqueId(),
      x: Math.random() * (dimensions.width - PLATFORM_WIDTH),
      y: yPosition - platformSpacing - Math.random() * 10,
      type: platformType(),
    }
  }

  const generateObstacle = (yPosition: number): Obstacle => {
    const obstacleType: ObstacleKind = Math.random() < 0.5 ? "spike" : "saw"
    return {
      id: generateUniqueId(),
      x: Math.random() * (dimensions.width - OBSTACLE_SIZE),
      y: yPosition,
      type: obstacleType,
    }
  }

  const generatePowerUp = (yPosition: number): PowerUp => {
    const powerUpType: PowerUpType = Math.random() < 0.5 ? "jetpack" : "shield"
    return {
      id: generateUniqueId(),
      x: Math.random() * (dimensions.width - POWER_UP_SIZE),
      y: yPosition,
      type: powerUpType,
    }
  }

  const generateMonster = (yPosition: number): Monster => {
    const monsterType: MonsterType = ["green", "blue", "red"][Math.floor(Math.random() * 3)] as MonsterType
    return {
      id: generateUniqueId(),
      x: Math.random() * (dimensions.width - OBSTACLE_SIZE),
      y: yPosition,
      type: monsterType,
    }
  }

  const gameLoop = (time: number) => {
    if (previousTimeRef.current === undefined) {
      previousTimeRef.current = time
    }
    const deltaTime = time - previousTimeRef.current
    previousTimeRef.current = time

    if (gameState === "playing" || gameState === "falling") {
      setGameTime((prevTime) => prevTime + deltaTime)

      // Handle player movement
      let newVelocityX = playerVelocityX
      if (gameState === "playing") {
        if (keysPressed.current.ArrowLeft) {
          newVelocityX -= MOVE_ACCELERATION
          setPlayerDirection("left")
        } else if (keysPressed.current.ArrowRight) {
          newVelocityX += MOVE_ACCELERATION
          setPlayerDirection("right")
        }

        newVelocityX *= FRICTION
        newVelocityX = Math.max(Math.min(newVelocityX, MAX_VELOCITY), -MAX_VELOCITY)

        if (Math.abs(newVelocityX) < 0.1) {
          newVelocityX = 0
        }
      } else {
        // When falling, slow down horizontal movement
        newVelocityX *= 0.98
      }

      setPlayerVelocityX(newVelocityX)

      // Update player position
      setPlayerX((prevX) => {
        const newX = prevX + newVelocityX
        if (newX < -PLAYER_SIZE) return dimensions.width
        if (newX > dimensions.width) return -PLAYER_SIZE
        return newX
      })

      setPlayerY((prevY) => prevY - playerVelocityY * (deltaTime / 16))
      setPlayerVelocityY((prevVelocity) => prevVelocity - GRAVITY * (deltaTime / 16))

      // Update spring animation targets
      springX.set(playerX)
      springY.set(playerY)

      if (gameState === "playing") {
        // Handle platform collisions
        platforms.forEach((platform) => {
          if (
            playerY + PLAYER_SIZE >= platform.y &&
            playerY + PLAYER_SIZE <= platform.y + PLATFORM_HEIGHT &&
            playerX + PLAYER_SIZE > platform.x &&
            playerX < platform.x + PLATFORM_WIDTH &&
            playerVelocityY < 0
          ) {
            playSoundEffect(playJump)
            if (platform.type === "breakable") {
              setPlatforms((prevPlatforms) => prevPlatforms.filter((p) => p.id !== platform.id))
              createParticles(platform.x + PLATFORM_WIDTH / 2, platform.y, 10, "#EF4444")
            } else if (platform.type === "boost") {
              setPlayerVelocityY(BOOST_VELOCITY)
              createParticles(platform.x + PLATFORM_WIDTH / 2, platform.y, 15, "#8B5CF6")
            } else {
              setPlayerVelocityY(JUMP_VELOCITY)
            }
            setCombo((prevCombo) => prevCombo + 1)
            setScore((prevScore) => prevScore + combo * 10)
            setLastPlatformJump(time)
          }
        })

        // Handle obstacle collisions
        obstacles.forEach((obstacle) => {
          if (
            playerY < obstacle.y + OBSTACLE_SIZE &&
            playerY + PLAYER_SIZE > obstacle.y &&
            playerX < obstacle.x + OBSTACLE_SIZE &&
            playerX + PLAYER_SIZE > obstacle.x
          ) {
            if (activeShield) {
              setActiveShield(false)
              createParticles(playerX + PLAYER_SIZE / 2, playerY + PLAYER_SIZE / 2, 20, "#60A5FA")
            } else {
              playSoundEffect(playHit)
              setGameState("falling")
            }
          }
        })

        // Handle monster collisions
        monsters.forEach((monster) => {
          if (
            playerY < monster.y + OBSTACLE_SIZE &&
            playerY + PLAYER_SIZE > monster.y &&
            playerX < monster.x + OBSTACLE_SIZE &&
            playerX + PLAYER_SIZE > monster.x
          ) {
            if (activeShield) {
              setActiveShield(false)
              createParticles(playerX + PLAYER_SIZE / 2, playerY + PLAYER_SIZE / 2, 20, "#60A5FA")
              setMonsters((prevMonsters) => prevMonsters.filter((m) => m.id !== monster.id))
            } else {
              playSoundEffect(playHit)
              setGameState("falling")
            }
          }
        })

        // Handle power-up collisions
        powerUps.forEach((powerUp) => {
          if (
            playerY < powerUp.y + POWER_UP_SIZE &&
            playerY + PLAYER_SIZE > powerUp.y &&
            playerX < powerUp.x + POWER_UP_SIZE &&
            playerX + PLAYER_SIZE > powerUp.x
          ) {
            playSoundEffect(playCollect)
            if (powerUp.type === "jetpack") {
              setActiveJetpack(true)
              setTimeout(() => setActiveJetpack(false), JETPACK_DURATION)
            } else if (powerUp.type === "shield") {
              setActiveShield(true)
              setTimeout(() => setActiveShield(false), SHIELD_DURATION)
            }
            setPowerUps((prevPowerUps) => prevPowerUps.filter((p) => p.id !== powerUp.id))
          }
        })

        // Apply jetpack effect
        if (activeJetpack) {
          setPlayerVelocityY(BOOST_VELOCITY)
        }

        // Handle combo system
        if (time - lastPlatformJump > COMBO_TIMEOUT) {
          setCombo(0)
        }

        // Move platforms and check for out-of-bounds
        setPlatforms((prevPlatforms) =>
          prevPlatforms
            .map((platform) => {
              if (platform.type === "moving") {
                return {
                  ...platform,
                  x: platform.x + Math.sin(gameTime / 500) * 2,
                }
              }
              return platform
            })
            .filter((platform) => platform.y < dimensions.height),
        )

        // Move obstacles
        setObstacles((prevObstacles) =>
          prevObstacles
            .map((obstacle) => {
              if (obstacle.type === "saw") {
                return {
                  ...obstacle,
                  x: obstacle.x + Math.sin(gameTime / 300) * 3,
                }
              }
              return obstacle
            })
            .filter((obstacle) => obstacle.y < dimensions.height),
        )

        // Generate new platforms and obstacles
        if (platforms[platforms.length - 1].y > 100) {
          const newPlatform = generatePlatform(platforms[platforms.length - 1].y)
          setPlatforms((prevPlatforms) => [...prevPlatforms, newPlatform])

          if (Math.random() < 0.3) {
            const newObstacle = generateObstacle(newPlatform.y - OBSTACLE_SIZE - 10)
            setObstacles((prevObstacles) => [...prevObstacles, newObstacle])
          }
        }

        // Generate new monsters
        if (Math.random() < 0.01) {
          const newMonster = generateMonster(playerY - dimensions.height)
          setMonsters((prevMonsters) => [...prevMonsters, newMonster])
        }

        // Generate new power-ups
        if (Math.random() < 0.01) {
          const newPowerUp = generatePowerUp(playerY - dimensions.height)
          setPowerUps((prevPowerUps) => [...prevPowerUps, newPowerUp])
        }

        // Scroll game area
        if (playerY < dimensions.height / 2) {
          const diff = dimensions.height / 2 - playerY
          setPlayerY(dimensions.height / 2)
          setPlatforms((prevPlatforms) =>
            prevPlatforms.map((platform) => ({
              ...platform,
              y: platform.y + diff,
            })),
          )
          setObstacles((prevObstacles) =>
            prevObstacles.map((obstacle) => ({
              ...obstacle,
              y: obstacle.y + diff,
            })),
          )
          setMonsters((prevMonsters) =>
            prevMonsters.map((monster) => ({
              ...monster,
              y: monster.y + diff,
            })),
          )
          setPowerUps((prevPowerUps) =>
            prevPowerUps.map((powerUp) => ({
              ...powerUp,
              y: powerUp.y + diff,
            })),
          )
          setScore((prevScore) => prevScore + Math.floor(diff))
        }

        // Update particles
        setParticles((prevParticles) =>
          prevParticles
            .map((particle) => ({
              ...particle,
              x: particle.x + particle.vx,
              y: particle.y + particle.vy,
              vy: particle.vy + 0.1,
            }))
            .filter((particle) => particle.y < dimensions.height),
        )
      }

      // Check for game over
      if (playerY > dimensions.height * 1.5) {
        setGameState("gameOver")
        setHighScore((prevHighScore) => Math.max(prevHighScore, score))
        playSoundEffect(playGameOver)
      }
    }

    requestRef.current = requestAnimationFrame(gameLoop)
  }

  const createParticles = (x: number, y: number, count: number, color: string) => {
    const newParticles = Array.from({ length: count }, () => ({
      id: generateUniqueId(),
      x,
      y,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      color,
    }))
    setParticles((prevParticles) => [...prevParticles, ...newParticles])
  }

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop)
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
    }
  }, [
    gameState,
    playerY,
    playerVelocityY,
    playerX,
    playerVelocityX,
    platforms,
    obstacles,
    powerUps,
    gameTime,
    dimensions,
    particles,
    monsters,
  ])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (gameState === "playing") {
        keysPressed.current[e.key] = true
      }
      if (e.key === "p") {
        setGameState((prevState) => (prevState === "playing" ? "paused" : "playing"))
      }
    },
    [gameState],
  )

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysPressed.current[e.key] = false
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [handleKeyDown, handleKeyUp])

  const handleTouchMove = (e: React.TouchEvent) => {
    if (gameState === "playing" && gameRef.current) {
      const touch = e.touches[0]
      const gameRect = gameRef.current.getBoundingClientRect()
      const touchX = touch.clientX - gameRect.left
      const newX = touchX - PLAYER_SIZE / 2

      setPlayerDirection(touchX < playerX ? "left" : "right")
      setPlayerX(Math.max(0, Math.min(dimensions.width - PLAYER_SIZE, newX)))
    }
  }

  const startGame = () => {
    const initialPlatforms = initializePlatforms()
    setPlatforms(initialPlatforms)
    setObstacles([])
    setPowerUps([])
    setParticles([])
    setMonsters([])

    const firstPlatform = initialPlatforms[0]
    setPlayerX(firstPlatform.x + PLATFORM_WIDTH / 2 - PLAYER_SIZE / 2)
    setPlayerY(firstPlatform.y - PLAYER_SIZE)

    setGameState("playing")
    setScore(0)
    setGameTime(0)
    setPlayerVelocityY(0)
    setPlayerVelocityX(0)
    keysPressed.current = {}
    setCombo(0)
    setActiveJetpack(false)
    setActiveShield(false)
    setLastPlatformJump(0)
  }

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  const playSoundEffect = useCallback(
    (sound: () => void) => {
      if (!isMuted) {
        sound()
      }
    },
    [isMuted],
  )

  return (
    <div
      ref={gameRef}
      className="fixed inset-0 bg-blue-100 overflow-hidden touch-none"
      style={{
        backgroundImage: `url('data:image/svg+xml,${encodeURIComponent(`
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="cloud" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M25,60 a20,20 0 0,1 0,-40 a20,20 1 0,1 0,40" fill="#E6F3FF" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cloud)" />
          </svg>
        `)}')`,
      }}
      onTouchMove={handleTouchMove}
    >
      <AnimatePresence>
        {/* Player */}
        <motion.div
          key="player"
          className="absolute"
          style={{
            width: PLAYER_SIZE,
            height: PLAYER_SIZE,
            x: springX,
            y: springY,
          }}
          animate={{
            x: springX.get(),
            y: gameState === "falling" ? dimensions.height : springY.get(),
            rotate: gameState === "falling" ? 360 : 0,
          }}
          transition={{
            type: "spring",
            damping: 10,
            stiffness: 100,
            y: { duration: gameState === "falling" ? 1 : 0, ease: "easeIn" },
            rotate: { duration: gameState === "falling" ? 1 : 0, ease: "linear" },
          }}
          onAnimationComplete={() => {
            if (gameState === "falling") {
              setGameState("gameOver")
              setHighScore((prevHighScore) => Math.max(prevHighScore, score))
            }
          }}
        >
          <div className={`w-full h-full relative ${playerDirection === "left" ? "scale-x-[-1]" : ""}`}>
            <div
              className={`absolute inset-0 bg-green-500 rounded-full ${activeShield ? "ring-4 ring-blue-400 ring-opacity-50" : ""}`}
            >
              <div className="absolute top-1/4 left-1/4 w-1/2 h-1/4 bg-white rounded-full">
                <div className="absolute top-1/4 left-1/4 w-1/2 h-1/2 bg-black rounded-full" />
              </div>
            </div>
            {activeJetpack && (
              <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2">
                <div className="w-4 h-6 bg-orange-500 rounded-full animate-pulse" />
                <div className="w-6 h-8 bg-yellow-500 rounded-full animate-pulse" />
              </div>
            )}
          </div>
        </motion.div>

        {/* Platforms */}
        {platforms.map((platform) => (
          <motion.div
            key={platform.id}
            className={`absolute rounded-lg ${
              platform.type === "normal"
                ? "bg-green-400"
                : platform.type === "moving"
                  ? "bg-yellow-400"
                  : platform.type === "breakable"
                    ? "bg-red-400"
                    : "bg-purple-400"
            }`}
            style={{
              width: PLATFORM_WIDTH,
              height: PLATFORM_HEIGHT,
              x: platform.x,
              y: platform.y,
            }}
            animate={{ x: platform.x, y: platform.y }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
          />
        ))}

        {/* Monsters */}
        {monsters.map((monster) => (
          <Monster key={monster.id} x={monster.x} y={monster.y} type={monster.type} />
        ))}

        {/* Power-ups */}
        {powerUps.map((powerUp) => (
          <motion.div
            key={powerUp.id}
            className={`absolute ${powerUp.type === "jetpack" ? "bg-yellow-400" : "bg-blue-400"} rounded-full`}
            style={{
              width: POWER_UP_SIZE,
              height: POWER_UP_SIZE,
              x: powerUp.x,
              y: powerUp.y,
            }}
            animate={{
              x: powerUp.x,
              y: powerUp.y,
              scale: [1, 1.1, 1],
            }}
            transition={{
              scale: {
                repeat: Number.POSITIVE_INFINITY,
                duration: 1,
              },
            }}
          />
        ))}

        {/* Particles */}
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full"
            style={{
              width: 4,
              height: 4,
              x: particle.x,
              y: particle.y,
              backgroundColor: particle.color,
            }}
            animate={{ x: particle.x, y: particle.y, opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        ))}
      </AnimatePresence>

      {/* UI Overlay */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
        <div className="text-4xl font-bold text-gray-800">{score}</div>
        <div className="text-2xl font-semibold text-gray-800">Height: {Math.floor(score / 10)}m</div>
        <div className="text-2xl font-semibold text-yellow-600">Combo: x{combo}</div>
        <div className="flex gap-2">
          <SoundSettings isMuted={isMuted} toggleMute={toggleMute} />
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full bg-white/50 hover:bg-white/75"
            onClick={() => setGameState((prev) => (prev === "playing" ? "paused" : "playing"))}
          >
            {gameState === "playing" ? <PauseIcon /> : <PlayIcon />}
          </Button>
        </div>
      </div>

      {/* Menu States */}
      {(gameState === "menu" || gameState === "gameOver" || gameState === "paused") && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-center text-white p-8">
            {gameState === "menu" && (
              <>
                <h1 className="text-6xl font-bold mb-8">Monster Hop</h1>
                <Button onClick={startGame} className="text-xl px-8 py-6 bg-green-500 hover:bg-green-600">
                  Start Game
                </Button>
              </>
            )}
            {gameState === "gameOver" && (
              <>
                <h2 className="text-5xl font-bold mb-4">Game Over!</h2>
                <p className="text-3xl mb-2">Score: {score}</p>
                <p className="text-2xl mb-8">High Score: {highScore}</p>
                <Button onClick={startGame} className="text-xl px-8 py-6 bg-green-500 hover:bg-green-600">
                  Play Again
                </Button>
              </>
            )}
            {gameState === "paused" && (
              <>
                <h2 className="text-5xl font-bold mb-8">Paused</h2>
                <Button
                  onClick={() => setGameState("playing")}
                  className="text-xl px-8 py-6 bg-green-500 hover:bg-green-600"
                >
                  Resume
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

