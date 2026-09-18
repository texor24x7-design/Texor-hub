/** Pure logic — no server, no database. */
import { __reset, rateLimit } from '../src/middleware/rateLimit.js';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

/** Runs the middleware once and reports what it did, the way Express would. */
const call = (mw, req) => new Promise((resolve) => {
  const res = { headers: {}, set(key, value) { this.headers[key] = value; } };
  mw(req, res, (err) => resolve({ err, headers: res.headers }));
});

const ip = (address) => ({ ip: address });
const user = (id, address = '10.0.0.1') => ({ ip: address, user: { _id: id } });

console.log('\n── rate limit ──');

__reset();
const three = rateLimit({ name: 't', limit: 3 });
const first = [];
for (let i = 0; i < 3; i += 1) first.push((await call(three, ip('1.1.1.1'))).err);
eq('lets the allowance through', first.map(Boolean), [false, false, false]);

const over = await call(three, ip('1.1.1.1'));
eq('blocks the next one', over.err?.status, 429);
eq('uses the rate_limited code', over.err?.code, 'rate_limited');
eq('sets Retry-After', Boolean(over.headers['Retry-After']), true);
eq('stays blocked', (await call(three, ip('1.1.1.1'))).err?.status, 429);

eq('a different IP is unaffected', (await call(three, ip('2.2.2.2'))).err, undefined);

__reset();
const perUser = rateLimit({ name: 'u', limit: 2 });
await call(perUser, user('alice'));
await call(perUser, user('alice'));
eq('a user spends their own allowance', (await call(perUser, user('alice'))).err?.status, 429);
eq('a colleague on the same IP is not punished', (await call(perUser, user('bob'))).err, undefined);

__reset();
const brief = rateLimit({ name: 'w', limit: 1, windowMs: 25 });
await call(brief, ip('3.3.3.3'));
eq('blocked inside the window', (await call(brief, ip('3.3.3.3'))).err?.status, 429);
await new Promise((r) => { setTimeout(r, 40); });
eq('allowed again once the window passes', (await call(brief, ip('3.3.3.3'))).err, undefined);

__reset();
const named = rateLimit({ name: 'a', limit: 1 });
const other = rateLimit({ name: 'b', limit: 1 });
await call(named, ip('4.4.4.4'));
eq('limits do not leak between routes', (await call(other, ip('4.4.4.4'))).err, undefined);

process.exit(failed ? 1 : 0);
