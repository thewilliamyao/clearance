// The camera's clarity tiers. SENSOR is the resolution the unit sees at (shown scaled up to
// the 320x240 screen); TONE is how many tones or colours it can show. The first tier of each
// is what a new Recorder gets; the last is what the Office grants for the final review.

export const SENSORS = [
  { w: 40, h: 30, name: 'SENSOR I', spec: '40×30' },
  { w: 64, h: 48, name: 'SENSOR II', spec: '64×48' },
  { w: 80, h: 60, name: 'SENSOR III', spec: '80×60' },
  { w: 160, h: 120, name: 'SENSOR IV', spec: '160×120' },
  { w: 320, h: 240, name: 'SENSOR V', spec: '320×240' },
];

// live: dither for the moving viewfinder; still: how a developed exposure is printed.
export const TONES = [
  { name: 'TONE I', spec: '1-BIT, NO DITHER', levels: 2, live: 'threshold', still: 'threshold' },
  { name: 'TONE II', spec: '1-BIT DITHERED', levels: 2, live: 'ordered', still: 'atkinson' },
  { name: 'TONE III', spec: '4 TONES', levels: 4, live: 'ordered', still: 'atkinson' },
  { name: 'TONE IV', spec: '8 TONES', levels: 8, live: 'ordered', still: 'floyd' },
  { name: 'CHROMA', spec: '16 COLOURS', color: 'pal16' },
  { name: 'TRUE COLOUR', spec: '32K COLOURS', color: 'true' },
];

export const LENSES = [
  { zoom: 1, name: 'LENS I', spec: 'FIXED 1×' },
  { zoom: 2, name: 'LENS II', spec: 'ZOOM TO 2×' },
  { zoom: 4, name: 'LENS III', spec: 'ZOOM TO 4×' },
];

// Film is meant to be scarce (Nov 25: about a sixth less than the first 12 / 18 / 24 / 36).
export const FILMS = [
  { n: 10, name: 'FILM I', spec: '10 EXPOSURES' },
  { n: 15, name: 'FILM II', spec: '15 EXPOSURES' },
  { n: 20, name: 'FILM III', spec: '20 EXPOSURES' },
  { n: 30, name: 'FILM IV', spec: '30 EXPOSURES' },
];

// Merit multiplier for a sharper sensor: better evidence is worth more to the Office.
export const SENSOR_BONUS = [1, 1.1, 1.25, 1.4, 1.6];
