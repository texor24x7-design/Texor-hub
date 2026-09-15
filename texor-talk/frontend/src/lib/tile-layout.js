/**
 * Working out how big video tiles should be.
 *
 * CSS alone cannot do this well. A grid of `1fr` rows holding aspect-ratio
 * tiles leaves the tiles smaller than their cells and pinned to one corner, and
 * `auto-fit` only ever reasons about width — which is how two people ended up
 * as a pair of letterboxes at the top of an otherwise empty screen.
 *
 * The question is really an optimisation: of every way to arrange N tiles in a
 * box, which gives the largest tile that still fits? That has a small search
 * space — at most N column counts — so it is cheaper to try them all than to
 * approximate it, and the answer is exact rather than nearly right.
 *
 * Kept free of React and the DOM so it can be tested directly.
 */

/** 16:9 matches what cameras actually produce, so tiles are not letterboxed. */
export const TILE_ASPECT = 16 / 9;

/**
 * The arrangement that makes each tile as large as possible.
 *
 * Returns the column and row counts and the exact pixel size of one tile. The
 * caller sets that width on the tiles and lets flexbox centre them, which is
 * what produces a block that is centred both ways however many people there are.
 */
export function bestTileLayout({
  count,
  width,
  height,
  gap = 8,
  aspect = TILE_ASPECT,
  minWidth = 120,
}) {
  if (count < 1 || width <= 0 || height <= 0) {
    return { cols: 1, rows: 1, tileWidth: 0, tileHeight: 0 };
  }

  let best = { cols: 1, rows: count, tileWidth: 0, tileHeight: 0 };

  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);

    // The space one cell gets once the gaps between them are taken out.
    const cellWidth = (width - gap * (cols - 1)) / cols;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    // Fit the tile inside the cell without distorting it: whichever of the two
    // dimensions runs out first is the one that decides the size.
    const tileWidth = Math.min(cellWidth, cellHeight * aspect);

    if (tileWidth > best.tileWidth) {
      best = { cols, rows, tileWidth, tileHeight: tileWidth / aspect };
    }
  }

  /**
   * Past a certain point, more tiles means tiles too small to recognise anyone
   * in. Rather than shrink indefinitely, hold a floor and let the container
   * scroll — a legible half of the room beats an illegible whole one.
   */
  if (best.tileWidth < minWidth) {
    const cols = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
    return {
      cols,
      rows: Math.ceil(count / cols),
      tileWidth: minWidth,
      tileHeight: minWidth / aspect,
      scrolls: true,
    };
  }

  return { ...best, scrolls: false };
}

export default { bestTileLayout, TILE_ASPECT };
