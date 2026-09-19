/**
 * The mirror into Texor Notes.
 *
 * Pure: no Notes server, no Talk server, no database. `fetch` is replaced, so
 * what is being checked is exactly what Talk would send and exactly when — and,
 * most of all, that a Talk deployment without the mirror configured cannot tell
 * this file exists.
 */
import { createHmac } from 'node:crypto';

const env = (await import('../src/config/env.js')).default;
const sync = await import('../src/services/notes-sync.service.js');

let pass = 0, fail = 0;
const check = (l, ok, x = '') => { ok ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${x}`)); };

const calls = [];
let reply = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return reply(); };

const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });

const note = {
  _id: '6712a0000000000000000001',
  title: '',
  meetingTitle: 'Q3 review',
  ownerTexorId: 'tx-bo',
  ownerName: 'Bo Reader',
  ownerPicture: '',
  blocks: [
    { type: 'paragraph', text: 'we shipped it', marks: [{ type: 'bold', start: 3, end: 10 }] },
    { type: 'quote', text: 'ship on the 14th', marks: [], speakerTexorId: 'tx-ana', speakerName: 'Ana' },
  ],
};

console.log('\n── when the mirror is not configured ──');
{
  // The state of every deployment until somebody fills in two variables. Set
  // here rather than read, so a developer who has wired their own .env to Notes
  // still gets a meaningful answer from this suite.
  env.notesSync = { origin: '', key: '', webhookSecret: '', enabled: false };

  sync.pushNote(note, { email: 'bo@texor.app' });
  sync.pushDelete(note);
  await settle();

  check('an unconfigured push makes no request at all', calls.length === 0, String(calls.length));
  check('and nothing inbound is trusted without a secret',
    sync.verifySignature(Buffer.from('{}'), 'sha256=anything') === false);
}

console.log('\n── when it is ──');
{
  env.notesSync = { origin: 'http://notes.test', key: 'ntk_live_x', webhookSecret: 's3cret', enabled: true };

  sync.pushNote(note, { email: 'bo@texor.app', displayName: 'Bo Reader' });
  await settle();

  const [call] = calls;
  const body = JSON.parse(call.options.body);

  check('saving a note pushes it once', calls.length === 1);
  check('to the notes API, with the key in the header',
    call.url === 'http://notes.test/api/v1/notes' && call.options.headers['x-api-key'] === 'ntk_live_x');
  check("under the Talk note's own id", body.externalId === note._id);
  check('the blocks cross unchanged', JSON.stringify(body.blocks) === JSON.stringify(note.blocks));
  check('including who said a quote', body.blocks[1].speakerName === 'Ana');
  check("a note with no title borrows the meeting's", body.title === 'Q3 review');
  check("it names the person it belongs to, not the key's owner",
    body.owner.texorId === 'tx-bo' && body.owner.email === 'bo@texor.app');
  check('and says where to find it in Talk', body.url.endsWith(`/notes/${note._id}`));

  calls.length = 0;
  sync.pushDelete(note);
  await settle();
  check("a delete is addressed by Talk's id",
    calls[0]?.url === `http://notes.test/api/v1/notes/external:${note._id}` && calls[0]?.options.method === 'DELETE');
  check('and still says whose note it is', JSON.parse(calls[0].options.body).owner.texorId === 'tx-bo');
}

console.log('\n── when Texor Notes is down ──');
{
  calls.length = 0;
  reply = () => { throw new Error('connect ECONNREFUSED'); };

  let threw = false;
  try {
    sync.pushNote(note, {});
  } catch {
    threw = true;
  }
  await settle();

  check('a dead Notes server does not throw into the save path', threw === false);
  check('and leaves no unhandled rejection behind', unhandled === 0, String(unhandled));

  reply = () => new Response('{}', { status: 503 });
  sync.pushNote(note, {});
  await settle();
  check('nor does one that answers with an error', unhandled === 0);
}

console.log('\n── edits arriving from Notes ──');
{
  const bytes = Buffer.from(JSON.stringify({ event: 'note.updated', note: { externalId: note._id } }));
  const good = `sha256=${createHmac('sha256', 's3cret').update(bytes).digest('hex')}`;

  check('a correctly signed change is accepted', sync.verifySignature(bytes, good));
  check('a change signed with the wrong secret is not',
    !sync.verifySignature(bytes, `sha256=${createHmac('sha256', 'nope').update(bytes).digest('hex')}`));

  const tampered = Buffer.from(bytes.toString().replace('updated', 'deleted'));
  check('nor is one altered after it was signed', !sync.verifySignature(tampered, good));
  check('nor one with no signature at all', !sync.verifySignature(bytes, undefined));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
