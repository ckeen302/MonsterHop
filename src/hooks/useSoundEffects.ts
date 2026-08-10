"use client"

import { useCallback, useEffect, useRef } from "react"

// All sound effects are synthesized with the Web Audio API so the game
// needs no audio asset files. The AudioContext is created lazily on the
// first user gesture (browsers block audio before any interaction).
export function useSoundEffects() {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const mutedRef = useRef(false)

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return null
      const ctx = new AudioCtx()
      const master = ctx.createGain()
      master.gain.value = mutedRef.current ? 0 : 1
      master.connect(ctx.destination)
      ctxRef.current = ctx
      masterRef.current = master
    }
    if (ctxRef.current.state === "suspended") {
      void ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted
    if (masterRef.current && ctxRef.current) {
      masterRef.current.gain.setTargetAtTime(muted ? 0 : 1, ctxRef.current.currentTime, 0.02)
    }
  }, [])

  // Play a single tone with a pitch sweep and quick fade-out.
  const tone = useCallback(
    (
      type: OscillatorType,
      startFreq: number,
      endFreq: number,
      duration: number,
      volume: number,
      startAt = 0,
    ) => {
      const ctx = ctxRef.current
      const master = masterRef.current
      if (!ctx || !master) return
      const t0 = ctx.currentTime + startAt
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(startFreq, t0)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration)
      gain.gain.setValueAtTime(volume, t0)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
      osc.connect(gain)
      gain.connect(master)
      osc.start(t0)
      osc.stop(t0 + duration + 0.02)
    },
    [],
  )

  const noiseBurst = useCallback((duration: number, volume: number, filterFreq: number) => {
    const ctx = ctxRef.current
    const master = masterRef.current
    if (!ctx || !master) return
    const t0 = ctx.currentTime
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.value = filterFreq
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    src.start(t0)
  }, [])

  // The classic springy "boing"
  const playJump = useCallback(() => {
    tone("triangle", 460, 240, 0.13, 0.25)
    tone("sine", 920, 480, 0.13, 0.08)
  }, [tone])
  const playSpring = useCallback(() => {
    tone("triangle", 300, 1100, 0.28, 0.25)
    tone("sine", 600, 2200, 0.28, 0.1)
  }, [tone])
  const playShoot = useCallback(() => tone("square", 1200, 380, 0.08, 0.15), [tone])
  const playStomp = useCallback(() => {
    tone("square", 260, 100, 0.14, 0.22)
    noiseBurst(0.08, 0.12, 1400)
  }, [tone, noiseBurst])
  const playBreak = useCallback(() => noiseBurst(0.16, 0.3, 900), [noiseBurst])
  const playCollect = useCallback(() => {
    tone("sine", 700, 700, 0.09, 0.2)
    tone("sine", 1050, 1050, 0.12, 0.2, 0.08)
  }, [tone])
  const playHit = useCallback(() => {
    tone("sawtooth", 420, 70, 0.35, 0.26)
    noiseBurst(0.2, 0.18, 600)
  }, [tone, noiseBurst])
  const playSucked = useCallback(() => tone("sawtooth", 500, 40, 0.7, 0.22), [tone])
  const playEnemyShoot = useCallback(() => tone("sawtooth", 280, 140, 0.14, 0.14), [tone])
  const playShieldPop = useCallback(() => {
    tone("sine", 1200, 400, 0.18, 0.2)
    noiseBurst(0.08, 0.1, 2000)
  }, [tone, noiseBurst])
  const playGameOver = useCallback(() => {
    tone("triangle", 523, 523, 0.18, 0.22)
    tone("triangle", 392, 392, 0.18, 0.22, 0.18)
    tone("triangle", 262, 262, 0.4, 0.22, 0.36)
  }, [tone])

  useEffect(() => {
    return () => {
      if (ctxRef.current) void ctxRef.current.close()
    }
  }, [])

  return {
    ensureAudio,
    setMuted,
    playJump,
    playSpring,
    playShoot,
    playStomp,
    playBreak,
    playCollect,
    playHit,
    playSucked,
    playEnemyShoot,
    playShieldPop,
    playGameOver,
  }
}
