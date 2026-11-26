// A hand-drawn 5x7 bitmap font (uppercase, digits, punctuation, a few symbols).
// Glyphs are trimmed to their used columns, so text is proportional. Lowercase is drawn
// as uppercase: every form in the Office is typed in capitals.

const G = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '###.. #..#. #...# #...# #...# #..#. ###..',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '.#. ##. .#. .#. .#. .#. ###',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '##### ...#. ..#.. ...#. ....# #...# .###.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '..##. .#... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ...#. .##..',
  '.': '. . . . . . #',
  ',': '.. .. .. .. .. .# #.',
  ':': '. # . . . # .',
  ';': '.. .# .. .. .. .# #.',
  '!': '# # # # # . #',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  "'": '# # . . . . .',
  '"': '#.# #.# ... ... ... ... ...',
  '-': '.... .... .... #### .... .... ....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '=': '.... .... #### .... #### .... ....',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '(': '..# .#. #.. #.. #.. .#. ..#',
  ')': '#.. .#. ..# ..# ..# .#. #..',
  '[': '### #.. #.. #.. #.. #.. ###',
  ']': '### ..# ..# ..# ..# ..# ###',
  '<': '...# ..#. .#.. #... .#.. ..#. ...#',
  '>': '#... .#.. ..#. ...# ..#. .#.. #...',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  '$': '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '|': '# # # # # # #',
  '°': '.#. #.# .#. ... ... ... ...',
  '·': '. . . # . . .',
  '—': '..... ..... ..... ##### ..... ..... .....',
  '–': '.... .... .... #### .... .... ....',
  '−': '.... .... .... #### .... .... ....',
  '…': '..... ..... ..... ..... ..... ..... #.#.#',
  '▸': '#... ##.. ###. #### ###. ##.. #...',
  '◂': '...# ..## .### #### .### ..## ...#',
  '▴': '..... ..... ..#.. .###. ##### ..... .....',
  '▾': '..... ..... ##### .###. ..#.. ..... .....',
  '●': '..... .###. ##### ##### ##### .###. .....',
  '○': '..... .###. #...# #...# #...# .###. .....',
  '■': '..... ##### ##### ##### ##### ##### .....',
  '□': '..... ##### #...# #...# #...# ##### .....',
  '✓': '..... ....# ....# ...#. #.#.. .#... .....',
  '×': '..... #...# .#.#. ..#.. .#.#. #...# .....',
  '←': '..... ..#.. .#... ##### .#... ..#.. .....',
  '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
  '↑': '..#.. .###. #.#.# ..#.. ..#.. ..#.. .....',
  '↓': '..... ..#.. ..#.. ..#.. #.#.# .###. ..#..',
};

export const GLYPH_H = 7;
export const LINE_H = 9;
const SPACE_W = 3;

// Decode to {w, rows: Uint8Array of bitmasks}, trimming unused columns on both sides.
const GLYPHS = {};
for (const [ch, def] of Object.entries(G)) {
  const rows = def.split(' ');
  if (rows.length !== GLYPH_H) throw new Error(`glyph ${ch} has ${rows.length} rows`);
  let min = 99, max = -1;
  for (const r of rows) for (let i = 0; i < r.length; i++) if (r[i] === '#') { min = Math.min(min, i); max = Math.max(max, i); }
  if (max < 0) { min = 0; max = 0; }
  const w = max - min + 1;
  const bits = new Uint8Array(GLYPH_H);
  rows.forEach((r, y) => { for (let x = min; x <= max; x++) if (r[x] === '#') bits[y] |= 1 << (x - min); });
  GLYPHS[ch] = { w, bits };
}
export const glyphChars = () => Object.keys(GLYPHS);

function glyph(ch) {
  if (ch === ' ') return null;
  return GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS['?'];
}

export function textWidth(s, scale = 1) {
  let w = 0;
  for (const ch of String(s)) { const g = glyph(ch); w += (g ? g.w + 1 : SPACE_W + 1) * scale; }
  return Math.max(0, w - scale);
}

// Draws text with its top-left at (x, y). Options: scale, align ('left'|'center'|'right'),
// bg (fills a box behind the text), pad (box padding), shadow (colour drawn 1px down-right).
export function drawText(scr, s, x, y, color, o = {}) {
  s = String(s);
  const scale = o.scale || 1;
  const w = textWidth(s, scale);
  if (o.align === 'center') x -= (w / 2) | 0;
  else if (o.align === 'right') x -= w;
  x |= 0; y |= 0;
  if (o.bg !== undefined) {
    const p = o.pad === undefined ? 2 : o.pad;
    scr.rect(x - p, y - p, w + p * 2, GLYPH_H * scale + p * 2, o.bg);
  }
  if (o.shadow !== undefined) drawRun(scr, s, x + scale, y + scale, o.shadow, scale);
  drawRun(scr, s, x, y, color, scale);
  return w;
}

function drawRun(scr, s, x, y, color, scale) {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    if (!g) { cx += (SPACE_W + 1) * scale; continue; }
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = g.bits[row];
      if (!bits) continue;
      for (let col = 0; col < g.w; col++) {
        if (!(bits & (1 << col))) continue;
        if (scale === 1) scr.pset(cx + col, y + row, color);
        else scr.rect(cx + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cx += (g.w + 1) * scale;
  }
}

// Greedy word wrap to a pixel width. Honours '\n'.
export function wrapText(s, maxW, scale = 1) {
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, scale) <= maxW || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// Cut a string to fit a width, adding an ellipsis.
export function fitText(s, maxW, scale = 1) {
  s = String(s);
  if (textWidth(s, scale) <= maxW) return s;
  while (s.length > 1 && textWidth(s + '…', scale) > maxW) s = s.slice(0, -1);
  return s + '…';
}
