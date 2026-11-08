import { describe, expect, it, vi } from 'vitest'
import { AudioEnergyMeter } from '../src/renderer/lib/audioEnergy'

function meter(sampleRate = 16000, sample = 0.004, tones: [number, number][] = []) {
  const spectrum = vi.fn((values: Float32Array) => {
    values.fill(-Infinity)
    for (const [hz, db] of tones) values[Math.round((hz * 1024) / sampleRate)] = db
  })
  const analyser = {
    context: { sampleRate },
    fftSize: 1024,
    frequencyBinCount: 512,
    disconnect: vi.fn(),
    getFloatTimeDomainData: (values: Float32Array) => values.fill(sample),
    getFloatFrequencyData: spectrum,
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const context = { createAnalyser: () => analyser }
  return {
    read: new AudioEnergyMeter(source as unknown as AudioNode, context as unknown as AudioContext),
    source,
    analyser,
    spectrum,
  }
}

describe('AudioEnergyMeter', () => {
  it('retains quiet, narrow speech peaks across sample rates without widening the band', () => {
    for (const rate of [16000, 48000]) {
      for (const [band, hz] of [
        ['low', 180],
        ['mid', 1000],
        ['high', 4500],
      ] as const) {
        const { read } = meter(rate, 0.004, [[hz, -65]])
        const energy = read.read()
        expect(energy.level).toBeCloseTo(0.032, 5)
        expect(energy[band]).toBeCloseTo(energy.level, 5)
        for (const other of (['low', 'mid', 'high'] as const).filter((value) => value !== band))
          expect(energy[other]).toBe(0)
      }
    }
  })
  it('uses linear power for relative EQ while keeping the measured level unchanged', () => {
    const { read } = meter(16000, 0.01, [
      [180, -20],
      [1000, -26],
      [4500, -40],
    ])
    const energy = read.read()
    expect(energy.level).toBeCloseTo(0.08, 5)
    expect(energy.low / energy.mid).toBeCloseTo(10 ** (6 / 20), 5)
    expect(energy.low / energy.high).toBeCloseTo(10, 5)
    expect(energy.low ** 2 + energy.mid ** 2 + energy.high ** 2).toBeCloseTo(energy.level ** 2, 6)
  })
  it('does not turn out-of-band sound or a silent spectrum into EQ energy', () => {
    expect(meter(48000, 0.01, [[12000, -20]]).read.read()).toEqual({
      level: expect.any(Number),
      low: 0,
      mid: 0,
      high: 0,
    })
    expect(meter().read.read()).toMatchObject({ low: 0, mid: 0, high: 0 })
    const silent = meter(16000, 0.0001, [[180, -20]])
    expect(silent.read.read()).toEqual({ level: 0, low: 0, mid: 0, high: 0 })
    expect(silent.spectrum).not.toHaveBeenCalled()
  })
  it('only attaches a passive analyser and disconnects it on disposal', () => {
    const { read, source, analyser } = meter()
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser)
    read.dispose()
    expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(analyser)
    expect(analyser.disconnect).toHaveBeenCalledOnce()
  })
})
