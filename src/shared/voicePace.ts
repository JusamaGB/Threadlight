export const VOICE_PACES = [
  'slower',
  'slightly-slower',
  'normal',
  'slightly-faster',
  'faster',
] as const
export type VoicePace = (typeof VOICE_PACES)[number]

export const VOICE_PACE: Record<
  VoicePace,
  { label: string; instruction: string; windowsRate: number }
> = {
  slower: {
    label: 'Slower',
    instruction: 'Speak slowly and clearly, with a comfortable pause between phrases.',
    windowsRate: -2,
  },
  'slightly-slower': {
    label: 'Slightly slower',
    instruction:
      'Speak a little more slowly than usual, with brief natural pauses between phrases.',
    windowsRate: -1,
  },
  normal: { label: 'Normal', instruction: '', windowsRate: 0 },
  'slightly-faster': {
    label: 'Slightly faster',
    instruction: 'Speak a little faster than usual while keeping each word clear.',
    windowsRate: 1,
  },
  faster: {
    label: 'Faster',
    instruction: 'Use a brisk, clear speaking pace and shorter pauses between phrases.',
    windowsRate: 2,
  },
}
