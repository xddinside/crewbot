// The sky's texture, built as data rather than painted in a component, so it
// can be reasoned about (and tested) without a DOM.
//
// Two properties matter and both are cheap to keep:
//
//  1. Determinism. The noise is seeded with a fixed constant and the glyph
//     table is fixed, so the sky is byte-identical on every machine, every
//     reload, every skin. A sky that reshuffles on window resize reads as a
//     bug; a sky that reshuffles per session reads as noise.
//
//  2. Cost. `buildSkyTexture` is O(cells). The caller paints the result once
//     into an offscreen canvas and never touches it again until a resize. There
//     is no animation loop and no per-frame work anywhere in this module.

/** A monospace character box for roughly 10px text. Wide enough that the
 *  texture reads as atmosphere rather than as a grid. */
export const SKY_CELL = { width: 8, height: 14 } as const;

/** Low-weight glyphs only. Nothing here forms a word or a shape: `.` and `·`
 *  are cloud, the rest is the rare brightening inside a dense patch. */
export const SKY_GLYPHS = [".", "·", ".", ".", ":", "-", "=", "+", "*"] as const;

/* The glyph most likely to be chosen, i.e. the dot. Keeps a dense patch
 * reading as one soft tone instead of a picket fence of different marks. */
const HEAVY_GLYPHS: readonly string[] = ["*", "+", "="];

/** Two octaves of value noise is the whole sky. One is banding, three is
 *  indistinguishable and slower. */
function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  // /2^32, so a signed 32-bit hash lands in [0,1)
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise over the integer lattice. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

export interface SkyTextureOptions {
  columns: number;
  rows: number;
  /** Shifts the whole pattern. Two skies with different seeds never tile
   *  against each other, which is what stops the texture looking repeated. */
  seed?: number;
  /** What fraction of the field carries a glyph at all, 0..1. The sky wants
   *  most of itself to be empty paper with a few soft cloud masses on it;
   *  much above this it stops reading as atmosphere and starts reading as
   *  noise, competing with the text drawn over it. */
  coverage?: number;
}

export interface SkyCell {
  /** column index, 0-based */
  x: number;
  /** row index, 0-based */
  y: number;
  glyph: string;
  /** 0..1 — alpha the caller paints this glyph at. Edges sit near 0.42,
   *  cloud cores near 0.97; the canvas is painted at full opacity so this
   *  single value is the whole edge-to-core range. */
  alpha: number;
  /** true when the glyph is one of the heavy marks, i.e. inside a cloud
   *  core rather than its edge. Lets the caller draw a second, brighter
   *  pass for the cores without a second noise field. */
  heavy: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** A stable permutation of SKY_GLYPHS chosen by noise value. Indexed, so the
 *  same input always yields the same glyph and the whole texture can be
 *  compared in a test. */
function glyphFor(value: number, heavy: boolean): string {
  if (heavy) return HEAVY_GLYPHS[Math.floor(value * HEAVY_GLYPHS.length) % HEAVY_GLYPHS.length];
  return SKY_GLYPHS[Math.floor(value * SKY_GLYPHS.length) % SKY_GLYPHS.length];
}

/**
 * The field of glyphs for a sky of `columns × rows` cells.
 *
 * Two bands of noise are summed: a wide one that makes cloud masses, and a
 * narrow one that breaks their edges up. The sum is then *thresholded*, not
 * scaled — a cutoff is what creates the empty paper.
 *
 * The cutoff is found by measuring the field rather than assumed, because the
 * noise this hash produces is not centred on the midpoint: its median sits
 * near 0.44 and its long tail runs high, so a cutoff picked on paper puts the
 * coverage wherever the distribution happens to fall. Two passes (measure,
 * then draw) is still O(cells) and still no animation.
 */
export function buildSkyTexture({
  columns,
  rows,
  seed = 1337,
  coverage = 0.46,
}: SkyTextureOptions): SkyCell[] {
  const width = Math.max(0, Math.floor(columns));
  const height = Math.max(0, Math.floor(rows));
  const total = width * height;
  if (!total) return [];

  // Scaled so the noise field has a fixed number of features regardless of
  // window size — a 4K window gets more cells but the same few clouds.
  const spanX = 9;
  const spanY = 5;

  const field = new Float32Array(total);
  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x / width) * spanX;
      const v = (y / height) * spanY;
      const wide = valueNoise(u, v, seed);
      const narrow = valueNoise(u * 2.7 + 11.3, v * 2.7 + 4.1, seed + 977);
      field[index++] = wide * 0.72 + narrow * 0.28;
    }
  }

  // The quantile that leaves exactly `coverage` of the field bare: the value
  // at (1 - coverage) is the first one kept.
  const ordered = Float32Array.from(field).sort();
  const keep = Math.round(clamp(coverage, 0, 1) * total);
  const cutoff = ordered[clamp(total - keep, 0, total - 1)];
  const span = Math.max(1e-6, 1 - cutoff);

  const cells: SkyCell[] = [];
  index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = field[index++];
      if (value < cutoff) continue;
      // 0 at the cloud's edge, 1 at its core. The gamma keeps cores small: the
      // bright part of a cloud is a handful of cells, not half the mass.
      const depth = Math.pow((value - cutoff) / span, 1.6);
      const heavy = depth > 0.42;
      // Alpha carries the whole edge-to-core range, because the canvas is
      // painted at full opacity: an earlier version dimmed per-glyph *and*
      // again with a canvas opacity, which multiplied the two faintest values
      // together and left a sky nobody could see. The range below is measured
      // against the ground — edges land near 1.5:1, cores near 2.2:1, both far
      // below anything text could use and both clearly visible as atmosphere.
      const alpha = 0.42 + depth * 0.55;
      cells.push({ x, y, glyph: glyphFor(value, heavy), alpha, heavy });
    }
  }
  return cells;
}

/** How many cells a sky of `width` × `height` CSS pixels holds. */
export function skyGrid(width: number, height: number): { columns: number; rows: number } {
  return {
    columns: Math.ceil(Math.max(1, width) / SKY_CELL.width),
    rows: Math.ceil(Math.max(1, height) / SKY_CELL.height),
  };
}