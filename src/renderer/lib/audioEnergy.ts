import { SILENT_AUDIO, unit, type AudioEnergy } from '../../shared/motion'

/** A passive analysis branch; it never connects audio to an output or keeps a recording. */
export class AudioEnergyMeter {
  private analyser: AnalyserNode
  private samples: Float32Array<ArrayBuffer>
  private spectrum: Uint8Array<ArrayBuffer>

  constructor(
    private source: AudioNode,
    context: AudioContext,
  ) {
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.45
    source.connect(this.analyser)
    this.samples = new Float32Array(this.analyser.fftSize)
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount)
  }

  read(): AudioEnergy {
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    const level = unit(Math.sqrt(sum / this.samples.length) * 8)
    if (level < 0.008) return SILENT_AUDIO
    this.analyser.getByteFrequencyData(this.spectrum)
    const band = (from: number, to: number) => {
      const bin = this.analyser.context.sampleRate / this.analyser.fftSize
      const start = Math.max(1, Math.floor(from / bin))
      const end = Math.min(this.spectrum.length, Math.ceil(to / bin))
      let total = 0
      for (let i = start; i < end; i++) total += this.spectrum[i]!
      return end > start ? unit(total / ((end - start) * 255)) * level : 0
    }
    return { level, low: band(80, 350), mid: band(350, 2400), high: band(2400, 8000) }
  }

  dispose(): void {
    this.source.disconnect(this.analyser)
    this.analyser.disconnect()
  }
}
