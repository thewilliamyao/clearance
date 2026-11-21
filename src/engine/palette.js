// Display palettes. The viewfinder starts in two tones (ink + paper) and earns more tones,
// then colour. Themes are two-tone schemes after old monochrome monitors and print.
import { hex, mix } from './screen.js';

export const THEMES = [
  { id: 'ledger', name: 'LEDGER', ink: '#1d1b22', paper: '#d9d0b8' },
  { id: 'phosphor', name: 'PHOSPHOR', ink: '#0b1a10', paper: '#79ef97' },
  { id: 'amber', name: 'AMBER', ink: '#1b1006', paper: '#ffb74a' },
  { id: 'cyanotype', name: 'CYANOTYPE', ink: '#14305b', paper: '#e6ecee' },
  { id: 'liquid', name: 'LIQUID', ink: '#2b331f', paper: '#a6b36b' },
  { id: 'night', name: 'NIGHT', ink: '#050505', paper: '#c2c2c2' },
];

// The Office's stamp ink: the only colour on screen until the unit earns colour.
export const STAMP = hex('#c63a2c');

// A muted 16-colour print palette for the CHROMA tier (enough for skin, sky, brick, foliage).
export const PAL16 = [
  '#1b1a1f', '#e9e2cf', '#7a7468', '#b8b09c',
  '#39405a', '#5d80a6', '#a9c3d0', '#3e5a3a',
  '#7f9b5a', '#cdb65a', '#e2a24a', '#b4473c',
  '#78303a', '#d69a8a', '#9b6a4f', '#5b3f33',
].map(hex);

export function themeColors(theme) {
  const ink = hex(theme.ink), paper = hex(theme.paper);
  return { ink, paper, mid: mix(ink, paper, 0.5), dark: mix(ink, paper, 0.25), light: mix(ink, paper, 0.75) };
}

// n tones from ink to paper.
export function toneRamp(theme, n) {
  const ink = hex(theme.ink), paper = hex(theme.paper);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = n === 1 ? paper : mix(ink, paper, i / (n - 1));
  return out;
}
