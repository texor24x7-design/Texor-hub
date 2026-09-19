/**
 * Every icon a module asks for must be a real Lucide name.
 *
 * A name that does not exist renders as an empty square and a console warning —
 * nothing fails, nothing is logged server-side, and it survives review. That is
 * exactly how the expenses module shipped with `wallet-minus`, which Lucide has
 * never had.
 */
import { readFileSync } from 'node:fs';
import { CORE_MODULES } from '../src/modules/registry.js';
import { INDUSTRIES } from '../src/industries/index.js';

let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); }
};

console.log('\n── module icons ──');

const MANIFEST = '../../frontend/node_modules/lucide-react/dist/esm/dynamicIconImports.mjs';
let source = '';
try { source = readFileSync(new URL(MANIFEST, import.meta.url), 'utf8'); } catch { /* frontend deps not installed */ }

if (!source) {
  console.log('  skip  the frontend is not installed here, so Lucide\'s names cannot be read');
} else {
  const known = new Set([...source.matchAll(/["']([a-z0-9-]+)["']\s*:/g)].map((m) => m[1]));
  check('Lucide\'s icon list was read', known.size > 500, known.size);

  const used = new Map();
  const note = (icon, where) => { if (icon) used.set(icon, [...(used.get(icon) ?? []), where]); };

  for (const module of CORE_MODULES) note(module.icon, `module ${module.key}`);

  // The picker's shortlist lives in the frontend's JSX, which Node cannot
  // import, so it is read as text — a typo there is just as invisible.
  const iconSource = readFileSync(new URL('../../frontend/src/components/Icon.js', import.meta.url), 'utf8');
  const picker = iconSource.slice(iconSource.indexOf('MODULE_ICONS'));
  for (const [, icon] of picker.slice(0, picker.indexOf('];')).matchAll(/'([a-z0-9-]+)'/g)) note(icon, 'the icon picker');
  for (const pack of Object.values(INDUSTRIES)) {
    note(pack.icon, `pack ${pack.key}`);
    for (const [key, override] of Object.entries(pack.modules ?? {})) note(override.icon, `${pack.key} → ${key}`);
    for (const custom of pack.customModules ?? []) note(custom.icon, `${pack.key} → ${custom.key}`);
  }

  const missing = [...used.entries()].filter(([icon]) => !known.has(icon));
  check(`every icon in use is real (${used.size} checked)`, missing.length === 0,
    missing.map(([icon, where]) => `${icon} (${where.join(', ')})`));
}

console.log(`\n  ${failed ? `${failed} failed` : 'all ok'}\n`);
process.exit(failed ? 1 : 0);
