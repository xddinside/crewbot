// The full-bleed sky.
//
// The whole background of the application, and the reason there is no app
// window: the canvas reaches the edges of the viewport and everything else
// floats on it.
//
// Cost is the constraint. There is no animation loop, no `requestAnimationFrame`
// and no per-frame anything. The texture is painted once, on resize (debounced)
// and when the skin changes. A 1440×900 viewport is a 180×64 field, so the
// paint is a few thousand `fillText` calls — a few milliseconds, once.
//
// The backing store is the *viewport*, not the grid. An earlier version stored
// one pixel per cell and let CSS scale it up, which looks like a clever saving
// and is not: a 10px glyph rasterised into a single pixel is an antialiased
// smudge, and magnifying it turns the texture into grey mush. Real pixels, real
// glyphs, no scaling.

import { useEffect, useRef } from "react";
import { SKY_CELL, buildSkyTexture, skyGrid } from "@/lib/sky-texture";

const RESIZE_DEBOUNCE_MS = 200;

/** Reads a resolved CSS custom property off the document, so the sky follows
 *  the skin rather than hard-coding two palettes here. Returns null when the
 *  property is missing — a sky that cannot read its ink still paints the
 *  ground colour. */
function readToken(name: string): string | null {
  if (typeof getComputedStyle === "undefined" || typeof document === "undefined") return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || null;
}

/** Paints the field once. Exported so a test can assert the draw happens on a
 *  plain 2D context, with no animation. Returns how many glyphs it wrote. */
export function paintSky(
  ctx: CanvasRenderingContext2D,
  columns: number,
  rows: number,
  ink: string,
  inkSoft: string,
): number {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const cells = buildSkyTexture({ columns, rows });
  for (const cell of cells) {
    ctx.globalAlpha = cell.alpha;
    ctx.fillStyle = cell.heavy ? ink : inkSoft;
    ctx.fillText(cell.glyph, cell.x * SKY_CELL.width, cell.y * SKY_CELL.height);
  }
  ctx.globalAlpha = 1;
  return cells.length;
}

/**
 * The sky. Mounted once, as a sibling behind everything, sized to the viewport
 * by CSS rather than by measurement — a canvas that tracked a layout box would
 * repaint on every sidebar collapse.
 */
export function AsciiSky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-sans") || "monospace";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const draw = () => {
      if (disposed) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const grid = skyGrid(width, height);
      // The glyph box is a monospace character cell, so the font size has to
      // match the cell height for one glyph to land exactly in one cell.
      ctx.font = `${SKY_CELL.height - 4}px ${fontFamily}`;
      ctx.textBaseline = "alphabetic";
      paintSky(ctx, grid.columns, grid.rows, readToken("--sky-ink") ?? "#8fb6dd", readToken("--sky-ink-soft") ?? "#b8d2ec");
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(draw, RESIZE_DEBOUNCE_MS);
    };

    draw();

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);
    window.addEventListener("resize", schedule);

    // A skin change swaps --sky-ink; redraw so the texture stays visible on
    // both grounds instead of washing out on the dark one.
    const skins = typeof MutationObserver === "undefined" ? null : new MutationObserver(draw);
    skins?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      skins?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      data-ascii-sky=""
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ background: "var(--sky-ground)" }}
    >
      <canvas
        ref={ref}
        className="absolute left-0 top-0 h-full w-full"
        style={{ opacity: "var(--sky-opacity)" }}
      />
    </div>
  );
}

export { SKY_CELL };