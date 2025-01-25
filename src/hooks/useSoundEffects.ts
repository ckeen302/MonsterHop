import { useSound } from "use-sound"

export function useSoundEffects() {
  const [playJump] = useSound("/sounds/jump.mp3")
  const [playCollect] = useSound("/sounds/collect.mp3")
  const [playHit] = useSound("/sounds/hit.mp3")
  const [playGameOver] = useSound("/sounds/game-over.mp3")
  const [playBackgroundMusic, { stop: stopBackgroundMusic }] = useSound("/sounds/background-music.mp3", {
    loop: true,
    volume: 0.5,
  })

  return {
    playJump,
    playCollect,
    playHit,
    playGameOver,
    playBackgroundMusic,
    stopBackgroundMusic,
  }
}

