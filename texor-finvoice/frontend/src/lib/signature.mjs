/**
 * Preparing a signature image for printing.
 *
 * People rarely have a clean PNG. They photograph a signature on paper, and
 * pasted straight onto an invoice that prints as a grey rectangle with the
 * signature faint inside it. These functions look at what was uploaded, lift
 * the ink off the paper, and trim the result to the strokes.
 *
 * Pure: they take and return `{ data, width, height }` — the shape of an
 * ImageData — so the browser passes a canvas's pixels straight in, and the
 * tests pass plain arrays.
 */

/** Perceived brightness, 0 (black) to 1 (white). */
const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export const MIN_PRINT_WIDTH = 300;
const DEFAULT_THRESHOLD = 0.78;

/**
 * What is in this image: is it already cut out, how dark is the paper, how much
 * of it is actually ink, and where the ink sits.
 */
export function analyseSignature({ data, width, height }) {
  let transparent = 0;
  let inkPixels = 0;
  let paperTotal = 0;
  let paperCount = 0;
  let inkTotal = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 16) { transparent += 1; continue; }

      const light = luminance(data[i], data[i + 1], data[i + 2]);
      if (light < DEFAULT_THRESHOLD) {
        inkPixels += 1;
        inkTotal += light;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        paperTotal += light;
        paperCount += 1;
      }
    }
  }

  const pixels = width * height;
  const bounds = maxX < 0
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  return {
    width,
    height,
    bounds,
    hasTransparency: transparent / pixels > 0.02,
    inkRatio: inkPixels / pixels,
    inkDarkness: inkPixels ? 1 - inkTotal / inkPixels : 0,
    paperLightness: paperCount ? paperTotal / paperCount : 1,
    borderLightness: borderLightness({ data, width, height }),
  };
}

/**
 * How light the edge of the image is.
 *
 * A signature sits in the middle, so the border is the paper. This is measured
 * separately because a photo taken in poor light has a background too dark to
 * count as paper at all — every pixel then looks like ink, and `paperLightness`
 * has nothing left to average.
 */
function borderLightness({ data, width, height }, band = 2) {
  let total = 0;
  let count = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 16) return;
    total += luminance(data[i], data[i + 1], data[i + 2]);
    count += 1;
  };
  for (let x = 0; x < width; x += 1) {
    for (let b = 0; b < band; b += 1) {
      sample(x, b);
      sample(x, height - 1 - b);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let b = 0; b < band; b += 1) {
      sample(b, y);
      sample(width - 1 - b, y);
    }
  }
  return count ? total / count : 1;
}

/**
 * Problems worth telling someone about, worst first. `severity` is 'error' when
 * the image cannot be used at all, otherwise 'warning'.
 */
export function signatureIssues(analysis) {
  const issues = [];
  if (analysis.inkRatio < 0.0015 || analysis.bounds.width < 8) {
    issues.push({ code: 'empty', severity: 'error', message: 'This image looks blank. Check you picked the right file.' });
    return issues;
  }
  if (!analysis.hasTransparency && analysis.borderLightness < 0.7) {
    issues.push({ code: 'dark', severity: 'error', message: 'The background is too dark to remove. Photograph the signature on plain white paper in good light.' });
    return issues;
  }
  // Real ink reads around 0.8 and above; anything under 0.45 is pencil or a faded scan.
  if (analysis.inkDarkness < 0.45) {
    issues.push({ code: 'faint', severity: 'warning', message: 'The ink is very light and may disappear when printed. A black or dark blue pen works best.' });
  }
  if (analysis.bounds.width < MIN_PRINT_WIDTH) {
    issues.push({ code: 'small', severity: 'warning', message: `Only ${analysis.bounds.width} px wide, so it may look blurry on paper. Aim for at least ${MIN_PRINT_WIDTH} px.` });
  }
  if (analysis.inkRatio > 0.5) {
    issues.push({ code: 'busy', severity: 'warning', message: 'Most of this image is dark. Crop it close to the signature itself.' });
  }
  return issues;
}

/**
 * Lifts the ink off the paper.
 *
 * Anything lighter than `threshold` becomes transparent; what remains keeps its
 * own colour but takes an opacity from how dark it is, so the edges of a stroke
 * stay soft instead of turning into a jagged cut-out.
 */
export function removeBackground({ data, width, height }, { threshold = DEFAULT_THRESHOLD } = {}) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const light = luminance(data[i], data[i + 1], data[i + 2]);
    if (data[i + 3] < 16 || light >= threshold) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    // Full opacity for solid strokes, tapering to nothing at the paper's brightness.
    const strength = Math.min(1, (threshold - light) / (threshold * 0.6));
    out[i] = data[i];
    out[i + 1] = data[i + 1];
    out[i + 2] = data[i + 2];
    out[i + 3] = Math.round(Math.min(data[i + 3], 255) * strength);
  }
  return { data: out, width, height };
}

/** Crops to the visible ink, with a small breathing space around it. */
export function trim({ data, width, height }, { padding = 8 } = {}) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { data, width, height, cropped: false };

  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(width - 1, maxX + padding);
  const y1 = Math.min(height - 1, maxY + padding);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y += 1) {
    const from = ((y + y0) * width + x0) * 4;
    out.set(data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h, cropped: w !== width || h !== height };
}

/**
 * The whole preparation in one call: analyse, lift the ink when the image is
 * still on paper, then trim. Returns the pixels to store and what was done, so
 * the screen can say it rather than changing the file silently.
 */
export function prepareSignature(image, { removePaper } = {}) {
  const analysis = analyseSignature(image);
  const issues = signatureIssues(analysis);
  if (issues.some((i) => i.severity === 'error')) return { analysis, issues, applied: [], image: null };

  const lift = removePaper ?? !analysis.hasTransparency;
  const applied = [];

  let working = image;
  if (lift) {
    working = removeBackground(working);
    applied.push('background');
  }
  const trimmed = trim(working);
  if (trimmed.cropped) applied.push('trim');

  const after = analyseSignature(trimmed);
  const finalIssues = signatureIssues(after).filter((i) => i.code !== 'busy');
  return { analysis: after, issues: finalIssues, applied, image: trimmed };
}
