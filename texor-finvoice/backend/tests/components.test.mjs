/**
 * Every component a page renders must actually be in scope.
 *
 * A missing import is not a build error — the bundler leaves it as an undefined
 * global and the page throws only when that branch renders. `StatusBadge` went
 * out that way when Attendance.js was split out of Staff.js: the import list
 * came across without it, the build passed, and the Today tab died on the first
 * marked day. `ButtonLink` was missing on the same file's empty state, which no
 * seeded workspace ever reaches.
 *
 * There is no linter in the frontend, so this is that check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); }
};

console.log('\n── components in scope ──');

const ROOT = new URL('../../frontend/src/', import.meta.url).pathname;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Names that are in scope without an import. */
const GLOBAL = new Set(['Fragment', 'Math', 'Object', 'Array', 'Number', 'String', 'Date', 'JSON', 'Boolean', 'Intl', 'Error', 'Promise', 'Map', 'Set', 'URL', 'URLSearchParams', 'FormData', 'File', 'Image']);

const scanned = [];
const broken = [];

for (const path of files(ROOT)) {
  const src = readFileSync(path, 'utf8');
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1]));
  if (!used.size) continue;

  const imported = new Set();
  for (const m of src.matchAll(/import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) imported.add(m[1]);
    // `Foo as Bar` is in scope under Bar.
    if (m[2]) for (const part of m[2].split(',')) { const name = part.trim().split(/\s+as\s+/).pop(); if (name) imported.add(name); }
  }
  // Declared in the file itself: `function Foo`, `const Foo =`, and anything
  // bound by a destructuring pattern — including a renamed one in an arrow's
  // parameters, which is how `{ icon: Glyph }` puts Glyph in scope.
  const declared = new Set([...src.matchAll(/(?:function|const|let|var|class)\s+([A-Z][A-Za-z0-9_$]*)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/\{([^{}]*)\}\s*(?:=>|=[^=]|\))/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split('=')[0].split(':').pop().trim();
      if (/^[A-Z][A-Za-z0-9_$]*$/.test(name)) declared.add(name);
    }
  }

  scanned.push(path);
  const missing = [...used].filter((n) => !imported.has(n) && !declared.has(n) && !GLOBAL.has(n));
  if (missing.length) broken.push(`${path.slice(ROOT.length)}: ${missing.join(', ')}`);
}

check(`every component file was read (${scanned.length})`, scanned.length > 20, scanned.length);
check('nothing renders a component that is not in scope', broken.length === 0, broken);

console.log(failed ? `\n  ${failed} failed\n` : '\n  all ok\n');
process.exit(failed ? 1 : 0);
