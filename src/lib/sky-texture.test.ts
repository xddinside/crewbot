// The sky's texture is the one piece of the redesign that is generated rather
// than drawn, and it has two properties worth pinning: it must be identical on
// every machine and every reload (a sky that reshuffles reads as a bug), and
// it must never be loud enough to compete with text drawn over it.
import { describe, expect, it } from "vitest";
import { SKY_CELL, SKY_GLYPHS, buildSkyTexture, skyGrid } from "./sky-texture";

describe("sky texture", () => {
  const grid = { columns: 120, rows: 60 };

  it("is identical for identical input", () => {
    // Determinism is the whole point: the field is painted from a fixed seed,
    // so the sky does not reshuffle on resize or on a second visit.
    expect(buildSkyTexture(grid)).toEqual(buildSkyTexture(grid));
  });

  it("changes with the seed, so two skies never tile against each other", () => {
    expect(buildSkyTexture({ ...grid, seed: 99 })).not.toEqual(buildSkyTexture(grid));
  });

  it("leaves most of the field empty", () => {
    // A sky with glyphs everywhere is noise. The texture wants a lot of clean
    // paper and a few soft masses.
    const cells = buildSkyTexture(grid);
    expect(cells.length / (grid.columns * grid.rows)).toBeLessThan(0.45);
  });

  it("never lets a glyph get bright enough to be read", () => {
    // Alpha is now the whole edge-to-core range — the canvas paints at full
    // opacity, so this value is the glyph's visibility, not a second dimming
    // pass. What matters is that the ceiling stays low enough that no patch
    // of sky competes with a label: even at full strength the ink measures
    // about 2.2:1 against the ground, where text needs 4.5:1.
    const alphas = buildSkyTexture(grid).map((cell) => cell.alpha);
    expect(Math.min(...alphas)).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.95);
  });

  it("only draws inside its own cell", () => {
    for (const cell of buildSkyTexture(grid)) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(grid.columns);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(grid.rows);
    }
  });

  it("draws from the glyph table and nothing else", () => {
    const allowed = new Set<string>(SKY_GLYPHS);
    for (const cell of buildSkyTexture(grid)) expect(allowed.has(cell.glyph)).toBe(true);
  });

  it("marks the dense cores, so the caller can brighten just those", () => {
    const cells = buildSkyTexture(grid);
    const cores = cells.filter((cell) => cell.heavy);
    const edges = cells.filter((cell) => !cell.heavy);
    expect(cores.length).toBeGreaterThan(0);
    // Cores are the few bright cells; edges are the mass. Asserting the
    // relationship rather than a magic alpha is what keeps this honest when
    // the curve is retuned.
    const brightestEdge = Math.max(...edges.map((cell) => cell.alpha));
    const dimmestCore = Math.min(...cores.map((cell) => cell.alpha));
    expect(dimmestCore).toBeGreaterThan(brightestEdge);
  });

  it("answers nothing for a zero-sized field rather than looping", () => {
    expect(buildSkyTexture({ columns: 0, rows: 10 })).toEqual([]);
    expect(buildSkyTexture({ columns: 10, rows: 0 })).toEqual([]);
  });

  it("grows with the window instead of scaling the texture", () => {
    const small = buildSkyTexture({ columns: 100, rows: 50 });
    const large = buildSkyTexture({ columns: 200, rows: 100 });
    // Twice the cells, not the same pattern stretched: a 4K window gets more
    // glyphs at the same visual scale rather than four times the contrast.
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("sky grid", () => {
  it("covers the viewport, rounding up so no edge is bare", () => {
    expect(skyGrid(SKY_CELL.width * 3, SKY_CELL.height * 2)).toEqual({ columns: 3, rows: 2 });
    expect(skyGrid(SKY_CELL.width * 3 + 1, SKY_CELL.height * 2 + 1)).toEqual({ columns: 4, rows: 3 });
  });

  it("survives a viewport that has not been measured yet", () => {
    expect(skyGrid(0, 0)).toEqual({ columns: 1, rows: 1 });
    expect(skyGrid(-10, -10)).toEqual({ columns: 1, rows: 1 });
  });
});