/**
 * Preparing an uploaded signature.
 *
 * The cases are the ones people actually upload: a photo of paper, a clean
 * cut-out PNG, a pencil scribble, a dark photo, and the wrong file entirely.
 */
import { analyseSignature, prepareSignature, removeBackground, signatureIssues, trim } from '../../frontend/src/lib/signature.mjs';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const ok = (label, value, extra = '') => {
  if (!value) failed += 1;
  console.log(`  ${value ? 'ok  ' : 'FAIL'} ${label}${value ? '' : ` ${extra}`}`);
};

/** Builds an image; `paint(x, y)` returns [r, g, b, a] or null for the background. */
function image(width, height, background, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const px = paint?.(x, y) ?? null;
      const [r, g, b, a] = px ?? background;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { data, width, height };
}

/** A stroke across the middle third, in the given colour. */
const stroke = (colour) => (x, y) => (x > 120 && x < 520 && y > 150 && y < 175 ? colour : null);

console.log('\n── signature preparation ──');

{
  // Photographed on white paper: slightly grey, never pure white.
  const photo = image(640, 320, [242, 240, 236, 255], stroke([18, 22, 70, 255]));
  const before = analyseSignature(photo);
  ok('a photo of paper is seen as opaque, not a cut-out', !before.hasTransparency);
  ok('its paper reads as light', before.paperLightness > 0.9, String(before.paperLightness));
  ok('and its ink as dark', before.inkDarkness > 0.7, String(before.inkDarkness));

  const result = prepareSignature(photo);
  eq('the paper is removed and the image cropped', result.applied, ['background', 'trim']);
  // Stroke is 399 × 24, plus 8 px of padding on each side.
  ok('the result is trimmed to the stroke plus padding', result.image.width === 415 && result.image.height === 40, `${result.image.width}×${result.image.height}`);

  const corner = result.image.data[3];
  eq('the corner is fully transparent', corner, 0);
  const middle = ((Math.floor(result.image.height / 2)) * result.image.width + Math.floor(result.image.width / 2)) * 4;
  ok('the ink stays opaque', result.image.data[middle + 3] > 200, String(result.image.data[middle + 3]));
  ok('no complaints about a good photo', result.issues.length === 0, JSON.stringify(result.issues));
}

{
  // Already a transparent PNG: nothing should be lifted off it.
  const png = image(640, 320, [0, 0, 0, 0], stroke([10, 10, 10, 255]));
  const analysis = analyseSignature(png);
  ok('transparency is detected', analysis.hasTransparency);
  const result = prepareSignature(png);
  eq('only the crop is applied', result.applied, ['trim']);
}

{
  // Pencil: pale grey ink on white.
  const pencil = image(640, 320, [255, 255, 255, 255], stroke([175, 175, 175, 255]));
  const codes = prepareSignature(pencil).issues.map((i) => i.code);
  ok('a faint scribble is flagged', codes.includes('faint'), JSON.stringify(codes));
}

{
  // A signature that fills only a small part of a small frame.
  const small = image(200, 120, [250, 250, 250, 255], (x, y) => (x > 40 && x < 160 && y > 55 && y < 65 ? [20, 20, 20, 255] : null));
  const issue = prepareSignature(small).issues.find((i) => i.code === 'small');
  ok('a low-resolution signature warns about printing blurry', Boolean(issue), JSON.stringify(prepareSignature(small).issues.map((i) => i.code)));
  ok('and it is still usable', Boolean(prepareSignature(small).image));
}

{
  // Photographed in bad light: the background is mid-grey, so there is nothing to lift.
  const dark = image(640, 320, [90, 92, 96, 255], stroke([12, 12, 12, 255]));
  const result = prepareSignature(dark);
  eq('a dark photo is refused', result.issues.map((i) => [i.code, i.severity]), [['dark', 'error']]);
  ok('and nothing is stored', result.image === null);
}

{
  const blank = image(400, 200, [255, 255, 255, 255], null);
  const result = prepareSignature(blank);
  eq('a blank image is refused', result.issues[0].code, 'empty');
  ok('with nothing stored', result.image === null);
}

{
  const logo = image(300, 300, [20, 20, 20, 255], null);
  const codes = signatureIssues(analyseSignature(logo)).map((i) => i.code);
  ok('a mostly dark image is called out', codes.includes('dark') || codes.includes('busy'), JSON.stringify(codes));
}

{
  // Trimming keeps the pixels themselves intact, just moved.
  const one = image(50, 50, [0, 0, 0, 0], (x, y) => (x === 25 && y === 25 ? [7, 8, 9, 255] : null));
  const cropped = trim(one, { padding: 2 });
  eq('trim leaves the padding it was asked for', [cropped.width, cropped.height], [5, 5]);
  const middle = (2 * 5 + 2) * 4;
  eq('and keeps the pixel', [cropped.data[middle], cropped.data[middle + 1], cropped.data[middle + 2], cropped.data[middle + 3]], [7, 8, 9, 255]);
}

{
  // Stroke edges taper rather than turning into a hard cut-out.
  const soft = image(10, 3, [255, 255, 255, 255], (x) => (x < 3 ? [0, 0, 0, 255] : x < 5 ? [180, 180, 180, 255] : null));
  const lifted = removeBackground(soft);
  ok('solid ink stays opaque', lifted.data[3] === 255, String(lifted.data[3]));
  const mid = lifted.data[3 * 4 + 3];
  ok('a soft edge keeps partial opacity', mid > 0 && mid < 255, String(mid));
  eq('paper is gone', lifted.data[9 * 4 + 3], 0);
}

process.exit(failed ? 1 : 0);
