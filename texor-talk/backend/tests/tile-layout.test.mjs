/**
 * Tile sizing.
 *
 * The visible symptom of getting this wrong was two people rendered as a pair
 * of letterboxes pinned to the top of an otherwise empty screen, so these
 * assertions are about filling the box and staying centred — not about matching
 * particular numbers.
 */
const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { bestTileLayout, TILE_ASPECT } = await import(`${FE}/src/lib/tile-layout.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const BOX = { width: 1600, height: 800, gap: 8 };
const fits = (n, l) => {
  const w = l.cols * l.tileWidth + (l.cols - 1) * BOX.gap;
  const h = l.rows * l.tileHeight + (l.rows - 1) * BOX.gap;
  return w <= BOX.width + 0.5 && h <= BOX.height + 0.5;
};

console.log('\n── every arrangement actually fits ──');
for (const count of [1, 2, 3, 4, 5, 6, 7, 9, 12, 16, 25]) {
  const l = bestTileLayout({ count, ...BOX });
  check(`${count} tiles fit in the box`, fits(count, l),
    `${l.cols}x${l.rows} @ ${Math.round(l.tileWidth)}x${Math.round(l.tileHeight)}`);
}

console.log('\n── it holds the aspect ratio ──');
for (const count of [1, 3, 8]) {
  const l = bestTileLayout({ count, ...BOX });
  check(`${count} tiles keep 16:9`, Math.abs(l.tileWidth / l.tileHeight - TILE_ASPECT) < 0.01);
}

console.log('\n── every cell is used ──');
for (const count of [2, 5, 7, 11]) {
  const l = bestTileLayout({ count, ...BOX });
  check(`${count} tiles need every row`, l.cols * l.rows >= count && (l.rows - 1) * l.cols < count,
    `${l.cols}x${l.rows}`);
}

console.log('\n── it picks the largest arrangement, not just a valid one ──');
{
  // Brute-force the answer independently and compare.
  for (const count of [2, 3, 4, 6, 9]) {
    const l = bestTileLayout({ count, ...BOX });
    let bestKnown = 0;
    for (let cols = 1; cols <= count; cols += 1) {
      const rows = Math.ceil(count / cols);
      const cw = (BOX.width - BOX.gap * (cols - 1)) / cols;
      const ch = (BOX.height - BOX.gap * (rows - 1)) / rows;
      if (cw > 0 && ch > 0) bestKnown = Math.max(bestKnown, Math.min(cw, ch * TILE_ASPECT));
    }
    check(`${count} tiles are as large as possible`, Math.abs(l.tileWidth - bestKnown) < 0.5,
      `${Math.round(l.tileWidth)} vs ${Math.round(bestKnown)}`);
  }
}

console.log('\n── one person gets the room ──');
{
  const one = bestTileLayout({ count: 1, ...BOX });
  check('a single tile uses the full height', Math.abs(one.tileHeight - BOX.height) < 1,
    `${Math.round(one.tileHeight)} of ${BOX.height}`);
  check('and is one row of one', one.cols === 1 && one.rows === 1);
}

console.log('\n── a tall narrow window stacks rather than squeezing ──');
{
  const portrait = bestTileLayout({ count: 2, width: 420, height: 900, gap: 8 });
  check('two tiles stack on a phone', portrait.cols === 1 && portrait.rows === 2,
    `${portrait.cols}x${portrait.rows}`);
}

console.log('\n── it stops shrinking eventually ──');
{
  // 60 in a large box still clears the floor comfortably — no scrolling needed.
  const roomy = bestTileLayout({ count: 60, ...BOX, minWidth: 120 });
  check('sixty in a wide window still fit without scrolling',
    roomy.scrolls === false && roomy.tileWidth >= 120, String(Math.round(roomy.tileWidth)));

  // Enough people, or a small enough window, and something has to give.
  const crowded = bestTileLayout({ count: 200, ...BOX, minWidth: 120 });
  check('two hundred hold a legible floor instead of shrinking',
    crowded.tileWidth === 120, String(Math.round(crowded.tileWidth)));
  check('and the container is told to scroll', crowded.scrolls === true);
  check('the floor still fits across the width',
    crowded.cols * 120 + (crowded.cols - 1) * BOX.gap <= BOX.width,
    `${crowded.cols} columns`);
}

console.log('\n── degenerate input does not explode ──');
for (const [label, args] of [
  ['zero tiles', { count: 0, ...BOX }],
  ['no width', { count: 4, width: 0, height: 800 }],
  ['no height', { count: 4, width: 800, height: 0 }],
]) {
  const l = bestTileLayout(args);
  check(`${label} returns something sane`,
    Number.isFinite(l.tileWidth) && l.tileWidth >= 0 && l.cols >= 1 && l.rows >= 1,
    JSON.stringify(l));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
