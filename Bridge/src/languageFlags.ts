/**
 * Flags for the language selector, drawn rather than typed.
 *
 * Emoji flags are not an option here: they are regional-indicator pairs, and
 * on Windows — where this runs — no installed font ligates them, so `🇧🇩`
 * renders as the letters "BD". These are tiny declarative specs instead,
 * painted as inline SVG, so a flag looks the same on every platform, stays
 * crisp at any size, and costs no network request or font.
 *
 * Shapes are simplified for a 24px disc: the layout and colours of a flag are
 * what identify it at that size, not its coat of arms. A language only gets a
 * flag where one region is genuinely conventional for it; languages spoken
 * across many countries with no such convention get a neutral globe instead,
 * because a flag that misrepresents its speakers is worse than no flag.
 */

export type FlagLayer =
  /** Equal or weighted stripes filling the field. */
  | { kind: 'bands'; dir: 'h' | 'v'; stops: readonly (readonly [string, number])[] }
  | { kind: 'rect'; fill: string; x: number; y: number; w: number; h: number }
  | { kind: 'disc'; fill: string; cx: number; cy: number; r: number }
  | { kind: 'star'; fill: string; cx: number; cy: number; r: number }
  /** A ring of colour with a bite taken out of it, as on Turkey or Pakistan. */
  | { kind: 'crescent'; fill: string; bg: string; cx: number; cy: number; r: number }
  | { kind: 'path'; fill: string; d: string }

export type Flag = readonly FlagLayer[]

/** Equal horizontal stripes, top to bottom. */
const h = (...colors: string[]): FlagLayer => ({
  kind: 'bands',
  dir: 'h',
  stops: colors.map((c) => [c, 1] as const),
})

/** Equal vertical stripes, left to right. */
const v = (...colors: string[]): FlagLayer => ({
  kind: 'bands',
  dir: 'v',
  stops: colors.map((c) => [c, 1] as const),
})

/** Stripes with explicit weights, for flags whose bands are not equal. */
const bands = (
  dir: 'h' | 'v',
  ...stops: (readonly [string, number])[]
): FlagLayer => ({ kind: 'bands', dir, stops })

const solid = (fill: string): FlagLayer => h(fill)

/** The off-centre cross shared by the Nordic flags. */
const nordic = (field: string, cross: string, inner?: string): Flag => [
  solid(field),
  { kind: 'rect', fill: cross, x: 7.5, y: 0, w: 4.5, h: 24 },
  { kind: 'rect', fill: cross, x: 0, y: 9.75, w: 24, h: 4.5 },
  ...(inner
    ? ([
        { kind: 'rect', fill: inner, x: 9, y: 0, w: 1.5, h: 24 },
        { kind: 'rect', fill: inner, x: 0, y: 11.25, w: 24, h: 1.5 },
      ] as FlagLayer[])
    : []),
]

const FLAGS: Record<string, Flag> = {
  // --- Plain stripes ------------------------------------------------------
  DE: [h('#000000', '#DD0000', '#FFCE00')],
  FR: [v('#002395', '#FFFFFF', '#ED2939')],
  IT: [v('#008C45', '#F4F5F0', '#CD212A')],
  NL: [h('#AE1C28', '#FFFFFF', '#21468B')],
  RU: [h('#FFFFFF', '#0039A6', '#D52B1E')],
  RO: [v('#002B7F', '#FCD116', '#CE1126')],
  HU: [h('#CD2A3E', '#FFFFFF', '#436F4D')],
  BG: [h('#FFFFFF', '#00966E', '#D62612')],
  LT: [h('#FDB913', '#006A44', '#C1272D')],
  EE: [h('#0072CE', '#000000', '#FFFFFF')],
  HR: [h('#FF0000', '#FFFFFF', '#171796')],
  RS: [h('#C6363C', '#0C4076', '#FFFFFF')],
  SK: [h('#FFFFFF', '#0B4EA2', '#EE1C25')],
  SI: [h('#FFFFFF', '#0000C6', '#DE2918')],
  AM: [h('#D90012', '#0033A0', '#F2A800')],
  IR: [h('#239F40', '#FFFFFF', '#DA0000')],
  RW: [h('#00A1DE', '#FAD201', '#20603D')],
  UZ: [h('#0099B5', '#FFFFFF', '#1EB53A')],
  MN: [v('#C4272F', '#015197', '#C4272F')],
  NG: [v('#008751', '#FFFFFF', '#008751')],
  ID: [h('#CE1126', '#FFFFFF')],
  PL: [h('#FFFFFF', '#DC143C')],
  UA: [h('#0057B7', '#FFD700')],
  ES: [bands('h', ['#AA151B', 1], ['#F1BF00', 2], ['#AA151B', 1])],
  LV: [bands('h', ['#9E3039', 2], ['#FFFFFF', 1], ['#9E3039', 2])],
  BY: [bands('h', ['#CE1720', 2], ['#4AA657', 1])],
  TH: [
    bands(
      'h',
      ['#A51931', 1],
      ['#F4F5F8', 1],
      ['#2D2A4A', 2],
      ['#F4F5F8', 1],
      ['#A51931', 1],
    ),
  ],

  // --- Stripes with a mark ------------------------------------------------
  JP: [solid('#FFFFFF'), { kind: 'disc', fill: '#BC002D', cx: 12, cy: 12, r: 6 }],
  BD: [solid('#006A4E'), { kind: 'disc', fill: '#F42A41', cx: 10.5, cy: 12, r: 5.5 }],
  IN: [
    h('#FF9933', '#FFFFFF', '#138808'),
    { kind: 'disc', fill: '#000080', cx: 12, cy: 12, r: 2.6 },
  ],
  ET: [
    h('#078930', '#FCDD09', '#DA121A'),
    { kind: 'disc', fill: '#0F47AF', cx: 12, cy: 12, r: 5 },
  ],
  LA: [
    bands('h', ['#CE1126', 1], ['#002868', 2], ['#CE1126', 1]),
    { kind: 'disc', fill: '#FFFFFF', cx: 12, cy: 12, r: 4 },
  ],
  KZ: [solid('#00AFCA'), { kind: 'disc', fill: '#FEC50C', cx: 12, cy: 12, r: 4.4 }],
  MK: [solid('#D20000'), { kind: 'disc', fill: '#FFE600', cx: 12, cy: 12, r: 4.4 }],
  PT: [
    bands('v', ['#046A38', 2], ['#DA291C', 3]),
    { kind: 'disc', fill: '#FFE900', cx: 9.6, cy: 12, r: 3.6 },
  ],
  VN: [solid('#DA251D'), { kind: 'star', fill: '#FFFF00', cx: 12, cy: 12, r: 6 }],
  CN: [solid('#DE2910'), { kind: 'star', fill: '#FFDE00', cx: 10, cy: 10, r: 5 }],
  GH: [
    h('#CE1126', '#FCD116', '#006B3F'),
    { kind: 'star', fill: '#000000', cx: 12, cy: 12, r: 3.4 },
  ],
  MM: [
    h('#FECB00', '#34B233', '#EA2839'),
    { kind: 'star', fill: '#FFFFFF', cx: 12, cy: 12, r: 5 },
  ],
  TR: [
    solid('#E30A17'),
    { kind: 'crescent', fill: '#FFFFFF', bg: '#E30A17', cx: 10, cy: 12, r: 5 },
    { kind: 'star', fill: '#FFFFFF', cx: 17, cy: 12, r: 2.6 },
  ],
  PK: [
    bands('v', ['#FFFFFF', 1], ['#01411C', 3]),
    { kind: 'crescent', fill: '#FFFFFF', bg: '#01411C', cx: 15, cy: 12, r: 4.8 },
    { kind: 'star', fill: '#FFFFFF', cx: 20, cy: 10, r: 2.2 },
  ],
  AZ: [
    h('#0092BC', '#E4002B', '#00AE65'),
    { kind: 'crescent', fill: '#FFFFFF', bg: '#E4002B', cx: 11, cy: 12, r: 3.2 },
  ],

  // --- Crosses ------------------------------------------------------------
  DK: nordic('#C60C30', '#FFFFFF'),
  SE: nordic('#006AA7', '#FECC00'),
  NO: nordic('#BA0C2F', '#FFFFFF', '#00205B'),
  FI: nordic('#FFFFFF', '#003580'),
  IS: nordic('#02529C', '#FFFFFF', '#DC1E35'),
  GE: [
    solid('#FFFFFF'),
    { kind: 'rect', fill: '#FF0000', x: 10, y: 0, w: 4, h: 24 },
    { kind: 'rect', fill: '#FF0000', x: 0, y: 10, w: 24, h: 4 },
  ],

  // --- Cantons and panels -------------------------------------------------
  US: [
    bands(
      'h',
      ['#B31942', 1],
      ['#FFFFFF', 1],
      ['#B31942', 1],
      ['#FFFFFF', 1],
      ['#B31942', 1],
      ['#FFFFFF', 1],
      ['#B31942', 1],
    ),
    { kind: 'rect', fill: '#0A3161', x: 0, y: 0, w: 11, h: 10.3 },
  ],
  GR: [
    bands(
      'h',
      ['#0D5EAF', 1],
      ['#FFFFFF', 1],
      ['#0D5EAF', 1],
      ['#FFFFFF', 1],
      ['#0D5EAF', 1],
      ['#FFFFFF', 1],
      ['#0D5EAF', 1],
    ),
    { kind: 'rect', fill: '#0D5EAF', x: 0, y: 0, w: 10.3, h: 10.3 },
    { kind: 'rect', fill: '#FFFFFF', x: 4.1, y: 0, w: 2.1, h: 10.3 },
    { kind: 'rect', fill: '#FFFFFF', x: 0, y: 4.1, w: 10.3, h: 2.1 },
  ],
  IL: [
    solid('#FFFFFF'),
    { kind: 'rect', fill: '#0038B8', x: 0, y: 3, w: 24, h: 3.2 },
    { kind: 'rect', fill: '#0038B8', x: 0, y: 17.8, w: 24, h: 3.2 },
    {
      kind: 'path',
      fill: '#0038B8',
      d: 'M12 7.4 15.2 13 8.8 13Z M12 16.6 8.8 11 15.2 11Z',
    },
  ],
  KR: [
    solid('#FFFFFF'),
    { kind: 'disc', fill: '#003478', cx: 12, cy: 12, r: 5.4 },
    { kind: 'path', fill: '#C60C30', d: 'M6.6 12a5.4 5.4 0 0 1 10.8 0 2.7 2.7 0 0 0-5.4 0 2.7 2.7 0 0 1-5.4 0Z' },
  ],
  BR: [
    solid('#009B3A'),
    { kind: 'path', fill: '#FEDF00', d: 'M12 3 21 12 12 21 3 12Z' },
    { kind: 'disc', fill: '#002776', cx: 12, cy: 12, r: 3.6 },
  ],
  CZ: [
    h('#FFFFFF', '#D7141A'),
    { kind: 'path', fill: '#11457E', d: 'M0 0 12 12 0 24Z' },
  ],
  PH: [
    h('#0038A8', '#CE1126'),
    { kind: 'path', fill: '#FFFFFF', d: 'M0 0 13 12 0 24Z' },
    { kind: 'disc', fill: '#FCD116', cx: 4.2, cy: 12, r: 2.2 },
  ],
  MY: [
    bands(
      'h',
      ['#CC0001', 1],
      ['#FFFFFF', 1],
      ['#CC0001', 1],
      ['#FFFFFF', 1],
      ['#CC0001', 1],
      ['#FFFFFF', 1],
    ),
    { kind: 'rect', fill: '#010066', x: 0, y: 0, w: 13, h: 12 },
    { kind: 'crescent', fill: '#FFCC00', bg: '#010066', cx: 5.5, cy: 6, r: 3.4 },
  ],
  TW: [
    solid('#FE0000'),
    { kind: 'rect', fill: '#000095', x: 0, y: 0, w: 12, h: 12 },
    { kind: 'disc', fill: '#FFFFFF', cx: 6, cy: 6, r: 3.4 },
  ],
  ZA: [
    h('#002395', '#002395', '#DE3831'),
    { kind: 'path', fill: '#007A4D', d: 'M0 0 11 12 0 24 0 19 6 12 0 5Z' },
    { kind: 'rect', fill: '#FFFFFF', x: 0, y: 10.5, w: 24, h: 3 },
    { kind: 'path', fill: '#FFB612', d: 'M0 3 8 12 0 21Z' },
  ],
}

/**
 * The region a language is shown under. Chosen where one is conventional and
 * unlikely to mislead; languages without such a region are absent on purpose
 * and fall back to the globe.
 */
const REGION_BY_LANGUAGE: Record<string, string> = {
  af: 'ZA',
  ak: 'GH',
  am: 'ET',
  az: 'AZ',
  be: 'BY',
  bg: 'BG',
  bn: 'BD',
  cs: 'CZ',
  da: 'DK',
  de: 'DE',
  el: 'GR',
  en: 'US',
  es: 'ES',
  et: 'EE',
  fa: 'IR',
  fi: 'FI',
  fil: 'PH',
  fr: 'FR',
  gu: 'IN',
  ha: 'NG',
  he: 'IL',
  hi: 'IN',
  hr: 'HR',
  hu: 'HU',
  hy: 'AM',
  id: 'ID',
  is: 'IS',
  it: 'IT',
  ja: 'JP',
  jv: 'ID',
  ka: 'GE',
  kk: 'KZ',
  kn: 'IN',
  ko: 'KR',
  lo: 'LA',
  lt: 'LT',
  lv: 'LV',
  mk: 'MK',
  ml: 'IN',
  mn: 'MN',
  mr: 'IN',
  ms: 'MY',
  my: 'MM',
  nb: 'NO',
  nl: 'NL',
  no: 'NO',
  pa: 'IN',
  pl: 'PL',
  'pt-BR': 'BR',
  'pt-PT': 'PT',
  ro: 'RO',
  ru: 'RU',
  rw: 'RW',
  sd: 'PK',
  sk: 'SK',
  sl: 'SI',
  sr: 'RS',
  su: 'ID',
  sv: 'SE',
  te: 'IN',
  th: 'TH',
  tr: 'TR',
  uk: 'UA',
  ur: 'PK',
  uz: 'UZ',
  vi: 'VN',
  'zh-Hans': 'CN',
  'zh-Hant': 'TW',
  zu: 'ZA',
}

/** The flag to show beside a language, or `null` to fall back to the globe. */
export function flagForLanguage(code: string): Flag | null {
  const region = REGION_BY_LANGUAGE[code] ?? REGION_BY_LANGUAGE[code.split('-')[0]]
  if (!region) return null
  return FLAGS[region] ?? null
}
