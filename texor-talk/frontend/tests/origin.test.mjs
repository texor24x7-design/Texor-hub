/**
 * The address this deployment advertises.
 *
 * A meeting link pasted into a chat showed a title, a description and no
 * picture. Every tag was present and the card image rendered correctly — but
 * the tag named it at `http://localhost:3002/opengraph-image`, so every crawler
 * fetched nothing.
 *
 * The cause was not a missing variable. `next.config.mjs` inlines dev fallbacks
 * into `process.env` at build time, so `NEXT_PUBLIC_TALK_ORIGIN` was *set* — to
 * localhost — and every `?? fallback` written downstream was unreachable. These
 * checks are about that distinction: set is not the same as right.
 */
const FE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { resolveOrigin, isLocalOrigin, normalise } = await import(`${FE}/src/lib/origin.mjs`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const NOWHERE = { configured: undefined, productionUrl: undefined, deploymentUrl: undefined };

console.log('\n── a localhost value counts as no value ──');
{
  // The whole bug in one line: these are all "configured", and all useless to
  // anyone but the machine that built them.
  for (const value of [
    'http://localhost:3002',
    'http://localhost:3000/',
    'https://127.0.0.1:8080',
    'http://0.0.0.0:3002',
    'http://[::1]:3002',
  ]) check(`${value} is local`, isLocalOrigin(value), 'treated as a real host');

  check('so is nothing at all', isLocalOrigin(undefined));
  check('and an empty string', isLocalOrigin(''));
  check('and whitespace', isLocalOrigin('   '));

  check('a real host is not local', !isLocalOrigin('https://talk.texor.app'));
  check('nor is one that merely mentions localhost',
    !isLocalOrigin('https://localhost.texor.app'), 'matched too loosely');
}

console.log('\n── the platform fills the gap ──');
{
  // Vercel sets these on every deployment, so a forgotten variable degrades to
  // the right answer rather than to a dead link.
  check('an unset origin falls back to the project domain',
    resolveOrigin({ ...NOWHERE, productionUrl: 'talk.texor.app' }) === 'https://talk.texor.app');

  check('a localhost origin does too — this is the regression',
    resolveOrigin({ configured: 'http://localhost:3002', productionUrl: 'talk.texor.app' })
      === 'https://talk.texor.app',
    'an inlined localhost default still wins');

  check('the deployment URL is used when there is no project domain',
    resolveOrigin({ ...NOWHERE, deploymentUrl: 'talk-abc123.vercel.app' })
      === 'https://talk-abc123.vercel.app');

  check('but the project domain is preferred over it, so previews advertise the real card',
    resolveOrigin({ configured: '', productionUrl: 'talk.texor.app', deploymentUrl: 'talk-abc.vercel.app' })
      === 'https://talk.texor.app');
}

console.log('\n── a real configured value wins ──');
{
  check('it beats the platform',
    resolveOrigin({ configured: 'https://talk.texor.app', productionUrl: 'talk-abc.vercel.app' })
      === 'https://talk.texor.app');

  check('a trailing slash is not part of an origin',
    resolveOrigin({ configured: 'https://talk.texor.app/' }) === 'https://talk.texor.app');

  check('a missing protocol is assumed to be https',
    resolveOrigin({ configured: 'talk.texor.app' }) === 'https://talk.texor.app');

  check('an http origin is left alone — some deployments mean it',
    resolveOrigin({ configured: 'http://talk.internal' }) === 'http://talk.internal');
}

console.log('\n── development still works ──');
{
  check('nothing anywhere gives the dev origin', resolveOrigin(NOWHERE) === 'http://localhost:3002');
  check('and an explicit dev origin is kept',
    resolveOrigin({ ...NOWHERE, configured: 'http://localhost:3002' }) === 'http://localhost:3002');
}

console.log('\n── whatever it returns, `new URL()` must accept it ──');
{
  /**
   * `metadataBase: new URL(ORIGIN)` throws on a malformed value, which fails
   * the build rather than the preview — worth being sure about.
   */
  const inputs = [
    undefined, '', '   ', '/', 'talk.texor.app', 'https://talk.texor.app/',
    'HTTP://LOCALHOST:3002', 'talk.texor.app/', 'https://a.b.c.d.e',
  ];

  let bad = '';
  for (const configured of inputs) {
    for (const productionUrl of [undefined, 'talk.texor.app', '']) {
      const result = resolveOrigin({ configured, productionUrl, deploymentUrl: undefined });
      try { new URL(result); } catch { bad = `${JSON.stringify(configured)} → ${JSON.stringify(result)}`; }
    }
  }
  check('every combination parses as an absolute URL', bad === '', bad);

  check('and it never ends in a slash, which would double up in an image path',
    !resolveOrigin({ configured: 'https://talk.texor.app///' }).endsWith('/'));
  check('normalise leaves an empty value empty rather than inventing a host',
    normalise('') === '' && normalise(undefined) === '');
}

console.log('\n── the config that caused it ──');
{
  /**
   * The check that would have caught the original defect: a production build
   * that was handed nothing must not inline a localhost address into the
   * bundle, because a `??` downstream cannot tell that apart from a real one.
   */
  const NODE_ENV = process.env.NODE_ENV;
  const saved = {};
  const vars = ['NEXT_PUBLIC_TALK_ORIGIN', 'NEXT_PUBLIC_ACCOUNTS_ORIGIN', 'NEXT_PUBLIC_API_ORIGIN',
    'NEXT_PUBLIC_FINVOICE_ORIGIN', 'NEXT_PUBLIC_PAYROLL_ORIGIN', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'];
  for (const key of vars) { saved[key] = process.env[key]; delete process.env[key]; }

  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'talk.texor.app';
    const { default: config } = await import(`${FE}/next.config.mjs?production`);
    const env = config.env ?? {};

    /**
     * The rule covers the origins that end up in something a person or a
     * crawler follows. `NEXT_PUBLIC_API_ORIGIN` is deliberately exempt: it is
     * required in every environment rather than optional in some, so it has no
     * "not offered" state to degrade to and emptying it would only move the
     * failure.
     */
    const outward = ['NEXT_PUBLIC_TALK_ORIGIN', 'NEXT_PUBLIC_ACCOUNTS_ORIGIN',
      'NEXT_PUBLIC_FINVOICE_ORIGIN', 'NEXT_PUBLIC_PAYROLL_ORIGIN'];
    const localish = outward.filter((k) => env[k] && /localhost|127\.0\.0\.1/.test(env[k]));
    check('a production build inlines no localhost address into a link',
      localish.length === 0, localish.map((k) => `${k}=${env[k]}`).join(' '));

    check('and the talk origin is taken from the platform',
      env.NEXT_PUBLIC_TALK_ORIGIN === 'https://talk.texor.app', env.NEXT_PUBLIC_TALK_ORIGIN);

    check('an unset sibling is empty, so it is dropped from the switcher rather than linked to a laptop',
      env.NEXT_PUBLIC_ACCOUNTS_ORIGIN === '', env.NEXT_PUBLIC_ACCOUNTS_ORIGIN);

    process.env.NODE_ENV = 'development';
    const { default: dev } = await import(`${FE}/next.config.mjs?development`);
    check('development still gets its local defaults',
      dev.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN === 'http://localhost:3000', dev.env.NEXT_PUBLIC_ACCOUNTS_ORIGIN);
  } finally {
    for (const key of vars) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    if (NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = NODE_ENV;
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
