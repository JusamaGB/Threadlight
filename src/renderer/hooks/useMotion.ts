import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  IDLE_MOTION,
  type AudioEnergy,
  type MotionMode,
  type MotionSnapshot,
} from '../../shared/motion'

type EnergySource = AudioEnergy | RefObject<AudioEnergy>
const read = (source: EnergySource): AudioEnergy => ('current' in source ? source.current : source)
const labels: Record<MotionMode, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  transcribing: 'Finishing transcription',
  waiting: 'Waiting for you',
  error: 'Needs attention',
}

/** The panel's audio timer also feeds the separate dot while the panel is hidden. */
export function useMotion(mode: MotionMode, input: EnergySource, output: EnergySource) {
  const source = useRef<MotionSnapshot>(IDLE_MOTION)
  const latest = useRef({ mode, input, output })
  const [label, setLabel] = useState(labels[mode])
  useEffect(() => {
    latest.current = { mode, input, output }
  }, [mode, input, output])
  useEffect(() => {
    let spoken = 0
    let speakingLabel = ''
    let lastSent = ''
    const update = () => {
      const { mode, input, output } = latest.current
      const value = { mode, input: read(input), output: read(output) }
      source.current = value
      const human = value.input.level > 0.035
      const agent = value.output.level > 0.035
      if (human || agent) {
        spoken = performance.now()
        speakingLabel =
          human && agent ? 'You and agent speaking' : human ? 'You speaking' : 'Agent speaking'
      }
      setLabel(performance.now() - spoken < 180 && speakingLabel ? speakingLabel : labels[mode])
      const serial = JSON.stringify(value)
      if (serial !== lastSent) {
        window.threadlight.setMotion(value)
        lastSent = serial
      }
    }
    update()
    const timer = window.setInterval(update, 50)
    return () => {
      window.clearInterval(timer)
      window.threadlight.setMotion(IDLE_MOTION)
    }
  }, [])
  return { source, label }
}
