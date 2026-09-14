/**
 * What a media failure tells the user.
 *
 * These all arrive as a DOMException whose `name` is the only reliable part.
 * Collapsing them into one message — which is what this replaced — is the worst
 * answer available: a blocked permission, a missing device and a microphone
 * another application has taken need three different things done about them,
 * and the reader cannot tell which they have.
 */
const FE = new URL('../../frontend/', import.meta.url).pathname.replace(/\/$/, '');
const { describeMediaError } = await import(`${FE}/src/lib/media-errors.js`);

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const err = (name, message = '') => Object.assign(new Error(message), { name });

console.log('\n── each failure says something different ──');
const cases = [
  ['NotAllowedError', /blocked.*address bar/i],
  ['NotFoundError', /no microphone was found/i],
  ['NotReadableError', /another application/i],
  ['OverconstrainedError', /no longer available.*pick another/i],
  ['SecurityError', /secure connection/i],
];
for (const [name, pattern] of cases) {
  const text = describeMediaError(err(name), 'audio');
  check(`${name} is explained specifically`, pattern.test(text), text);
}

const messages = new Set(cases.map(([name]) => describeMediaError(err(name), 'audio')));
check('no two failures produce the same message', messages.size === cases.length,
  `${messages.size} distinct of ${cases.length}`);

console.log('\n── it names the right device ──');
check('audio is called a microphone', /microphone/i.test(describeMediaError(err('NotFoundError'), 'audio')));
check('video is called a camera', /camera/i.test(describeMediaError(err('NotFoundError'), 'video')));
check('the same code adapts per kind',
  describeMediaError(err('NotReadableError'), 'audio') !== describeMediaError(err('NotReadableError'), 'video'));

console.log('\n── the unknown case still says something ──');
check('an unrecognised name keeps the browser’s own message',
  /something the browser said/i.test(describeMediaError(err('WeirdError', 'something the browser said'), 'audio')),
  describeMediaError(err('WeirdError', 'something the browser said'), 'audio'));
check('a nameless error still returns a sentence',
  describeMediaError(undefined, 'audio').length > 10, describeMediaError(undefined, 'audio'));
check('an unknown kind does not print "undefined"',
  !/undefined/.test(describeMediaError(err('NotFoundError'), 'telepathy')),
  describeMediaError(err('NotFoundError'), 'telepathy'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
