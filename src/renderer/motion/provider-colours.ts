// Base tones match Threadlight's --provider-codex / --provider-claude theme tokens.
export const PROVIDER_COLOURS = {
  claude: {
    name: 'Claude',
    base: '#da8a62',
    rgb: [218 / 255, 138 / 255, 98 / 255],
    liquid: ['#fff2be', '#ffddb0', '#da8a62', '#b15e32', '#783c22'],
    metal: ['#fff0bb', '#efbb86', '#c7794c', '#ffc78a', '#da8a62'],
    glow: '#da8a62',
    glint: '#fff0c1',
    grooves: '#713e25',
    pool: ['#ffe1ad', '#da8a62', '#9d512600'],
    crown: '#f5c18c',
  },
  codex: {
    name: 'Codex',
    base: '#68aaff',
    rgb: [104 / 255, 170 / 255, 1],
    liquid: ['#eaf7ff', '#bcdeff', '#68aaff', '#2768c7', '#143b7a'],
    metal: ['#e4f4ff', '#a0cdff', '#3981da', '#b3dcff', '#68aaff'],
    glow: '#68aaff',
    glint: '#e2f5ff',
    grooves: '#173a6c',
    pool: ['#d9f0ff', '#68aaff', '#2864aa00'],
    crown: '#a6d4ff',
  },
} as const
