import { SILENT_AUDIO, unit, type AudioEnergy } from '../../shared/motion'

/** A passive analysis branch; it never connects audio to an output or keeps a recording. */
export class AudioEnergyMeter {
  private analyser: AnalyserNode
  private samples: Float32Array<ArrayBuffer>
  private spectrum: Float32Array<ArrayBuffer>

  constructor(
    private source: AudioNode,
    context: AudioContext,
  ) {
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.15
    source.connect(this.analyser)
    this.samples = new Float32Array(this.analyser.fftSize)
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount)
  }

  read(): AudioEnergy {
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    const level = unit(Math.sqrt(sum / this.samples.length) * 8)
    if (level < 0.008) return SILENT_AUDIO
    this.analyser.getFloatFrequencyData(this.spectrum)
    const bin = this.analyser.context.sampleRate / this.analyser.fftSize
    const powers = [0, 0, 0]
    let total = 0
    // FFT magnitudes are decibels. Sum linear power instead of averaging byte
    // values across a band's empty bins, which hid speech and narrow peaks.
    for (let i = 1; i < this.spectrum.length; i++) {
      const db = this.spectrum[i]!
      if (!Number.isFinite(db)) continue
      const power = 10 ** (db / 10)
      total += power
      const frequency = i * bin
      const band =
        frequency < 80 ? -1 : frequency < 350 ? 0 : frequency < 2400 ? 1 : frequency < 8000 ? 2 : -1
      if (band >= 0) powers[band]! += power
    }
    const band = (index: number) =>
      total > 0 ? unit(Math.sqrt(powers[index]! / total)) * level : 0
    return { level, low: band(0), mid: band(1), high: band(2) }
  }

  dispose(): void {
    this.source.disconnect(this.analyser)
    this.analyser.disconnect()
  }
}
