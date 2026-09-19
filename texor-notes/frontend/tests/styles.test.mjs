/**
 * Every class the app asks for exists in the stylesheet.
 *
 * ── Why ──
 *
 * Twice now a scripted edit has removed CSS that was still in use. The second
 * time took out the whole empty-meeting panel: the markup rendered, the build
 * passed, and what reached the browser was unstyled text jammed into the
 * top-left corner. Nothing could catch it but looking at the page.
 *
 * A missing rule is a static fact, so it does not need a browser. This walks
 * every `className` in the source, collects the names, and checks each one has
 * at least one rule somewhere in the stylesheets.
 *
 * It also flags a *layout* class defined twice, which was the first of the two
 * breakages: appending a second `.shell` rule left a stale
 * `grid-template-rows` applying underneath the new one and folded the page in
 * half.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const SRC = join(HERE, '..', 'src');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const files = walk(SRC);
const source = files.filter((f) => f.endsWith('.js'));
const sheets = files.filter((f) => f.endsWith('.css'));

check('there are stylesheets to check against', sheets.length > 0, String(sheets.length));
check('and source files to check', source.length > 5, String(source.length));

/* ── what the stylesheets define ──────────────────────────────────────────── */

const css = sheets.map((f) => readFileSync(f, 'utf8')).join('\n');
const defined = new Set();
for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(match[1]);

/* ── what the source asks for ─────────────────────────────────────────────── */

/**
 * Only string literals are read.
 *
 * `className={someVariable}` is skipped rather than guessed at — a check that
 * invents class names produces false alarms, and a test people learn to ignore
 * is worse than no test.
 */
const used = new Map();

/**
 * Split a literal into class names, dropping `${...}` holes.
 *
 * Removing a hole from `door--${tint}` leaves `door--`, which is half a name
 * rather than a name. A stem ending in a BEM separator is the interpolation's
 * remains and is skipped — the full class only exists once the value is known,
 * and this check cannot know it.
 */
function collect(piece, file) {
  for (const name of piece.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
    if (!name || !/^-?[_a-zA-Z][\w-]*$/.test(name)) continue;
    if (/(--|__|-)$/.test(name)) continue;
    if (!used.has(name)) used.set(name, file);
  }
}

for (const file of source) {
  const text = readFileSync(file, 'utf8');
  const short = file.slice(SRC.length + 1);

  /**
   * Braces nest, so a regex cannot find the end of the expression.
   *
   * `className={`a--${x ?? 'yellow'}`}` contains a `}` that closes the
   * interpolation, not the attribute. Matching to the first one truncated the
   * expression and left `yellow` looking like a class name. This counts depth.
   */
  for (const at of [...text.matchAll(/className=/g)].map((m) => m.index)) {
    const after = text.slice(at + 'className='.length);

    if (after.startsWith('"')) {
      const end = after.indexOf('"', 1);
      if (end > 0) collect(after.slice(1, end), short);
      continue;
    }
    if (!after.startsWith('{')) continue;

    let depth = 0;
    let end = -1;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] === '{') depth += 1;
      else if (after[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;

    /**
     * Comparison operands are values, not class names.
     *
     * `label === 'screen' ? 'tile--screen' : ''` mentions two strings and only
     * one of them is a class. Blanking the right-hand side of a comparison
     * keeps `tile--screen` and drops `screen`, which is the difference between
     * a check people trust and one they learn to ignore.
     */
    const expression = after.slice(1, end)
      .replace(/(===|!==|==|!=)\s*(['"`])(?:\\.|(?!\2)[^\\])*\2/g, '$1 0');

    for (const literal of expression.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      collect(literal[1] ?? literal[2] ?? literal[3] ?? '', short);
    }
  }
}

check('class names were actually found', used.size > 50, String(used.size));

console.log('\n── every class the app uses has a rule ──');
{
  const missing = [...used].filter(([name]) => !defined.has(name));

  for (const [name, file] of missing.slice(0, 20)) {
    console.log(`       ${name}  (${file})`);
  }

  check(`no class is used without a rule (${used.size} checked)`,
    missing.length === 0, `${missing.length} missing`);
}

console.log('\n── no layout class is defined twice ──');
{
  /**
   * Only the ones that lay out the page.
   *
   * A second `.badge` rule is a style being refined. A second `.shell` rule is
   * a stale `grid-template-rows` surviving underneath a new
   * `grid-template-columns`, which is what folded Texor Talk's app in half. The
   * stylesheet here was assembled out of that one, so the same trap applies.
   */
  const LAYOUT = ['shell', 'shell__body', 'shell__main', 'side', 'topbar', 'board', 'board__grid', 'lp', 'lp__hero'];

  const twice = LAYOUT.filter((name) => {
    const rule = new RegExp(`^\\.${name.replace(/[_-]/g, '[_-]')}\\s*\\{`, 'gm');
    return (css.match(rule) ?? []).length > 1;
  });

  check('each layout class has exactly one rule', twice.length === 0, twice.join(', '));
}

console.log('\n── it works on a phone ──');
{
  /**
   * Not "does it look right" — that needs eyes. These are the structural
   * mistakes that make a layout unusable on a phone and are visible in the
   * stylesheet: a screen the browser chrome can cover, a fixed width wider
   * than a phone, a tap target below the size every guideline asks for.
   */
  const sheets = walk(SRC).filter((f) => f.endsWith('.css'));
  const all = sheets.map((f) => readFileSync(f, 'utf8')).join('\n');

  check('there are phone-width rules at all',
    /@media[^{]*max-width:\s*(40rem|24rem|640px)/.test(all), 'none found');

  /*
   * `100vh` on a phone is taller than the visible page: the browser's own bar
   * sits over the bottom of it, which is where the primary button usually is.
   */
  const viewportHeights = [...all.matchAll(/(?:min-)?height:\s*100vh/g)];
  check('no full-screen surface is measured in vh rather than dvh',
    viewportHeights.length === 0, `${viewportHeights.length} uses of 100vh`);

  // A notch or a home indicator will cover anything that ignores the inset.
  check('the safe area is respected somewhere',
    all.includes('env(safe-area-inset'), 'never mentioned');

  // Horizontal scrolling on a phone is almost always one unbreakable string.
  check('long unbroken strings are allowed to break',
    all.includes('overflow-wrap: anywhere'), 'nothing breaks');

  /*
   * A `min-width` wider than a small phone forces the whole document sideways.
   * 22rem is 352px — narrower than any phone in use.
   */
  const wide = [...all.matchAll(/min-width:\s*(\d+(?:\.\d+)?)rem/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 22);
  check('nothing declares a min-width wider than a phone',
    wide.length === 0, wide.join(', '));
}

console.log('\n── the card a shared link shows ──');
{
  /**
   * A link pasted into a chat showed a title, a description and no picture —
   * because there was no `og:image`, and because without `metadataBase` any
   * image path stays relative, which every chat client ignores.
   */
  const { existsSync, readFileSync: read } = await import('node:fs');
  const layout = join(SRC, 'app', 'layout.js');
  const card = join(SRC, 'app', 'opengraph-image.js');

  check('there is a card image', existsSync(card));
  check('and the layout declaring it', existsSync(layout));

  if (existsSync(layout)) {
    const text = read(layout, 'utf8');
    // The one that made the difference: relative image URLs are dropped.
    check('an absolute base is set, so the image URL resolves',
      text.includes('metadataBase'), 'missing — the image will be ignored');
    check('the card is described for Open Graph', text.includes('openGraph'));
    check('and for Twitter, as a large image',
      /summary_large_image/.test(text), 'summary card crops to a thumbnail');
    /**
     * Resolved, not read. The variable is inlined with a fallback at build
     * time, so it is never absent — only sometimes localhost, which is how a
     * production card came to name its image on a laptop. Checking the file
     * merely mentions the variable would pass on a comment.
     */
    check('the base is resolved rather than read straight from the environment',
      /resolveOrigin\s*\(/.test(text), 'reads the raw variable, which may say localhost');
    check('and no local address is hard-coded into it',
      !/localhost|127\.0\.0\.1/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
      'a literal localhost origin');

    /**
     * `og:url` is a canonical claim, and scrapers cache a preview under it.
     * Set in the root layout it is inherited by every page, so each one says
     * it is the site root — and every shared note link would then share one
     * cached preview instead of being fetched on its own. Each shareable page states
     * its own instead.
     */
    check('the layout claims no canonical URL on behalf of every page',
      !/\burl:/.test(text), 'an inherited og:url collapses every page onto one');

    const note = join(SRC, 'app', 'notes', '[id]', 'layout.js');
    check('a note link carries its own canonical URL', existsSync(note));
    if (existsSync(note)) {
      const m = read(note, 'utf8');
      check('built from the id in the path',
        /`\/notes\/\$\{/.test(m) && /openGraph[\s\S]{0,120}\burl\b/.test(m),
        'the page does not state its own og:url');
    }
  }
}

console.log('\n── the tab icon ──');
{
  /**
   * Next builds these from files at fixed paths, so the check is that the
   * files are there and are what they claim. A missing one fails silently —
   * the browser simply shows its blank page glyph and nobody notices until a
   * tab is open next to a competitor's.
   */
  const { existsSync, readFileSync, statSync: stat } = await import('node:fs');
  const app = join(SRC, 'app');

  const svg = join(app, 'icon.svg');
  check('there is a tab icon', existsSync(svg));
  if (existsSync(svg)) {
    const markup = readFileSync(svg, 'utf8');
    check('it is really an SVG', markup.includes('<svg'));
    /**
     * The mark's own amber, which is also `--brand-400`. When real artwork
     * replaces the placeholder this is the line that notices the two have
     * drifted apart.
     */
    check('it is the brand mark', /#C9821F/i.test(markup), 'wrong artwork');
  }

  /**
   * ponytail: no apple-icon.png yet. The mark is a placeholder, and exporting a
   * PNG of a placeholder is work that gets thrown away — add one with the real
   * artwork, and this comment is the reminder.
   */
}

console.log('\n── the logo ──');
{
  const { existsSync } = await import('node:fs');
  const brand = join(SRC, '..', 'public', 'brand');

  check('the logo is in the app', existsSync(join(brand, 'notes-logo.svg')));
  check('and the mark beside it', existsSync(join(brand, 'notes-icon.svg')));

  /**
   * No dark cut, and no test for one. Texor Talk keeps a dark variant that goes
   * stale silently; this product has no dark surface to put one on, and an
   * unused second file is a thing to forget to update.
   */
  for (const sibling of ['accounts-icon.svg', 'talk-icon.svg', 'finvoice-icon.svg']) {
    check(`the switcher can draw ${sibling.split('-')[0]}`, existsSync(join(brand, sibling)));
  }
}

console.log('\n── the typeface ──');
{
  /**
   * One face for the whole product, loaded once and handed to the stylesheets
   * through a CSS variable.
   *
   * That indirection is what needs guarding. If the class carrying the
   * variable ever comes off the document element, `var(--font-notes)` resolves
   * to nothing, every stylesheet quietly falls through to its system fallback,
   * and the entire product renders in the wrong letters. Nothing errors, the
   * build passes, and the page looks plausible — the same shape of silent
   * failure as a deleted rule.
   */
  const { existsSync, readFileSync: read } = await import('node:fs');

  const layout = join(SRC, 'app', 'layout.js');
  const globals = join(SRC, 'styles', 'globals.css');
  const landing = join(SRC, 'styles', 'landing.css');

  const VAR = '--font-notes';

  if (existsSync(layout)) {
    const text = read(layout, 'utf8');
    check('the root layout loads the typeface',
      /from 'next\/font\/google'/.test(text), 'no font is loaded for the app');
    check('under the variable the stylesheets read',
      text.includes(`variable: '${VAR}'`), `not exposed as ${VAR}`);

    /**
     * The one that matters: declaring the variable does nothing until the
     * class is on an element the rest of the page inherits from.
     */
    check('and that variable is actually applied to the document',
      /<html[^>]*className=\{[^}]*\.variable/.test(text),
      'the variable is declared but never applied — everything falls back');

    check('it is self-hosted rather than fetched from Google at runtime',
      !/fonts\.(googleapis|gstatic)\.com/.test(text), 'links out to Google');
  }

  for (const [file, name, prop] of [
    [globals, 'the app', '--font'],
    [landing, 'the landing page', '--lp-sans-stack'],
  ]) {
    if (!existsSync(file)) continue;
    const text = read(file, 'utf8');
    const decl = text.match(new RegExp(`${prop}:([^;]*);`))?.[1] ?? '';

    check(`${name} is set in it`, decl.includes(`var(${VAR})`), decl.trim() || 'not declared');
    // A variable with nothing behind it renders as the browser's default serif
    // in the moment before the font arrives, which is worse than a plain stack.
    check(`${name} keeps a real fallback behind it`,
      /sans-serif\s*$/.test(decl.trim()), decl.trim());
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
