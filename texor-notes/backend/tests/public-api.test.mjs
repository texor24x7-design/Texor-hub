/**
 * The notes API, as somebody else's software sees it.
 *
 * The promise: a key gets you a place to put notes in one account and nothing
 * else, sending the same thing twice does not make two of it, and a person can
 * always take the access away again.
 */
import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { API, call, check, report, seedUser, section, wipe } from './helpers.mjs';

await connectForTests(process.env.MONGODB_URI);
await wipe('notes', 'labels', 'apikeys', 'connections', 'users', 'sessions', 'noteevents');

const dev = await seedUser({ texorId: 'tx-dev', email: 'dev@texor.app', displayName: 'Dee Veloper' });
// The runner puts this address in TRUSTED_KEY_EMAILS, which is the only way a
// key can ever be trusted.
const first = await seedUser({ texorId: 'tx-first', email: 'trusted@texor.app', displayName: 'First Party' });
const bystander = await seedUser({ texorId: 'tx-by', email: 'by@texor.app', displayName: 'By Stander' });

/** A call with a key instead of a cookie. */
const withKey = (token, path, options = {}) =>
  call(null, path, { ...options, headers: { 'x-api-key': token, ...(options.headers ?? {}) } });

section('making a key');
const made = await call(dev, '/api/keys', { method: 'POST', body: { appName: 'Acme CRM' } });
check('a key can be made from the settings screen', made.status === 201, JSON.stringify(made.body).slice(0, 160));
check('and is handed over exactly once', typeof made.body.token === 'string' && made.body.token.startsWith('ntk_live_'));
check('with a prefix to recognise it by later', made.body.key?.prefix?.startsWith('ntk_live_'));
check('a key made by an ordinary account is not trusted', made.body.key?.trusted === false);

const token = made.body.token;

{
  const listed = await call(dev, '/api/keys');
  check('the key is listed afterwards', listed.body.keys?.length === 1);
  check('but the key itself never appears again',
    JSON.stringify(listed.body).includes(token) === false);
  check('an app gets a label of its own', Boolean(listed.body.keys[0].label?.name === 'Acme CRM'));
}

section('writing a note through it');
{
  const created = await withKey(token, '/api/v1/notes', {
    method: 'POST',
    body: {
      externalId: 'crm-deal-8812',
      title: 'Acme renewal',
      colour: 'yellow',
      blocks: [{ type: 'todo', text: 'Send the revised quote', marks: [], done: false }],
    },
  });

  check('a note can be written with a key', created.status === 201, JSON.stringify(created.body).slice(0, 200));
  check('it comes back with the identifier the app knows it by',
    created.body.note?.externalId === 'crm-deal-8812');
  check('and a link a person can open', String(created.body.note?.url).includes('/notes/'));

  const mine = await call(dev, '/api/notes');
  check('it lands in the account that made the key', mine.body.notes?.length === 1);
  check("filed under the app's own label", mine.body.notes?.[0]?.labels?.length === 1);
  check('and says where it came from', mine.body.notes?.[0]?.source?.app === 'Acme CRM');

  const again = await withKey(token, '/api/v1/notes', {
    method: 'POST',
    body: { externalId: 'crm-deal-8812', title: 'Acme renewal — signed' },
  });
  check('posting the same externalId twice updates rather than duplicates', again.status === 200);
  check('and there is still only one note', (await call(dev, '/api/notes')).body.notes.length === 1);
  check('with the newer title', again.body.note?.title === 'Acme renewal — signed');

  const byTheirId = await withKey(token, '/api/v1/notes/external:crm-deal-8812');
  check("a note can be addressed by the app's own id", byTheirId.status === 200);

  const edited = await withKey(token, '/api/v1/notes/external:crm-deal-8812', {
    method: 'PATCH', body: { title: 'renamed over there' },
  });
  check('and edited that way too', edited.body.note?.title === 'renamed over there');
}

section('what a key cannot do');
{
  const typed = await call(dev, '/api/notes', { method: 'POST', body: { title: 'my own note' } });

  const peek = await withKey(token, '/api/v1/notes');
  check('a key sees only the notes it created', peek.body.notes?.length === 1, String(peek.body.notes?.length));
  check('not the ones its owner typed here',
    peek.body.notes?.every((note) => note.id !== typed.body.note.id));

  const reach = await withKey(token, `/api/v1/notes/${typed.body.note.id}`);
  check('and cannot reach one by id either', reach.status === 404, `HTTP ${reach.status}`);

  const onBehalf = await withKey(token, '/api/v1/notes', {
    method: 'POST',
    body: { title: 'not yours', owner: { texorId: 'tx-by', email: 'by@texor.app', name: 'By Stander' } },
  });
  check('an ordinary key asking to own a note for somebody else is refused',
    onBehalf.status === 403, `HTTP ${onBehalf.status}`);
  check('in terms that point at the fix', /trusted key/i.test(onBehalf.body.error?.message ?? ''));

  const nothing = await call(null, '/api/v1/notes');
  check('no key at all is a 401', nothing.status === 401);
  check('a made-up key is a 401 too',
    (await withKey('ntk_live_nonsense', '/api/v1/notes')).status === 401);
}

section('a first-party key, writing into the account of whoever wrote the note');
{
  const key = await call(first, '/api/keys', { method: 'POST', body: { appName: 'Texor Talk' } });
  check('a key made by a trusted account is trusted', key.body.key?.trusted === true);

  const forSomebodyElse = await withKey(key.body.token, '/api/v1/notes', {
    method: 'POST',
    body: {
      externalId: 'talk-note-1',
      title: 'Standup',
      owner: { texorId: 'tx-by', email: 'by@texor.app', name: 'By Stander' },
      blocks: [{ type: 'paragraph', text: 'we shipped it', marks: [] }],
    },
  });
  check('it may say who a note belongs to', forSomebodyElse.status === 201);
  check('and the note belongs to that person', forSomebodyElse.body.note?.owner?.texorId === 'tx-by');

  const theirs = await call(bystander, '/api/notes');
  check("it is on their board, not the key owner's",
    theirs.body.notes?.some((note) => note.title === 'Standup'));
  check('under a label named after the app',
    (await call(bystander, '/api/labels')).body.labels?.some((label) => label.name === 'Texor Talk' && label.locked));

  const notTheirs = await call(first, '/api/notes');
  check("and not on the key owner's board", notTheirs.body.notes?.every((note) => note.title !== 'Standup'));

  // Somebody who has never opened Notes still gets their note.
  const newcomer = await withKey(key.body.token, '/api/v1/notes', {
    method: 'POST',
    body: {
      externalId: 'talk-note-2',
      title: 'Kickoff',
      owner: { texorId: 'tx-never', email: 'never@texor.app', name: 'Never Been' },
    },
  });
  check('including for somebody who has never signed in here', newcomer.status === 201);
  const placeholder = await mongoose.connection.db.collection('users').findOne({ texorId: 'tx-never' });
  check('who gets a placeholder rather than an invented account',
    placeholder?.signedInAt === null, JSON.stringify(placeholder?.signedInAt));
}

section('deleting through the API');
{
  const gone = await withKey(token, '/api/v1/notes/external:crm-deal-8812', { method: 'DELETE' });
  check('an app can delete what it created', gone.status === 200);

  const trash = await call(dev, '/api/notes?scope=trash');
  check("and it lands in the person's trash rather than vanishing",
    trash.body.notes?.some((note) => note.title === 'renamed over there'));

  // The source has been edited again after somebody here binned the copy.
  const back = await withKey(token, '/api/v1/notes', {
    method: 'POST', body: { externalId: 'crm-deal-8812', title: 'reopened' },
  });
  check('a later update from the app brings it back', back.body.note?.deletedAt === null);
}

section('telling the app about changes made here');
{
  // The webhook half of two-way sync, checked by signing the payload the same
  // way the receiver would and comparing.
  const payload = JSON.stringify({ event: 'note.updated' });
  const secret = 'a-secret';
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const { sign } = await import(`${new URL('../', import.meta.url).pathname.replace(/\/$/, '')}/src/services/webhook.service.js`);
  check('outgoing calls are signed so the receiver can tell they are ours',
    sign(secret, payload) === expected);

  const withHook = await call(dev, '/api/keys', {
    method: 'POST', body: { appName: 'Hooked', webhookUrl: 'https://example.test/notes' },
  });
  check('a key with a webhook gets a secret to verify it by',
    typeof withHook.body.webhookSecret === 'string' && withHook.body.webhookSecret.length > 20);
  check('and the secret, like the key, is shown once',
    JSON.stringify((await call(dev, '/api/keys')).body).includes(withHook.body.webhookSecret) === false);
}

section('two-way: an edit made here reaches the app that wrote the note');
{
  /**
   * A real HTTP receiver standing in for Texor Talk, so what is checked is the
   * request that actually leaves this product: its address, its body and its
   * signature.
   */
  const { createServer } = await import('node:http');
  const received = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ body, signature: req.headers['x-notes-signature'] });
      res.writeHead(200).end('{}');
    });
  });
  await new Promise((resolve) => { receiver.listen(0, '127.0.0.1', resolve); });
  const hook = `http://127.0.0.1:${receiver.address().port}/api/integrations/notes`;

  const talk = await call(first, '/api/keys', {
    method: 'POST', body: { appName: 'Talk mirror', webhookUrl: hook },
  });
  const talkKey = talk.body.token;
  const secret = talk.body.webhookSecret;

  await withKey(talkKey, '/api/v1/notes', {
    method: 'POST',
    body: {
      externalId: 'talk-note-99',
      title: 'Retro',
      owner: { texorId: 'tx-by', email: 'by@texor.app', name: 'By Stander' },
      blocks: [{ type: 'paragraph', text: 'from talk', marks: [] }],
    },
  });

  const waitFor = async (count) => {
    for (let i = 0; i < 40 && received.length < count; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
  };

  await waitFor(1);
  check('a note arriving from the app is not sent straight back to it', received.length === 0,
    String(received.length));

  const board = await call(bystander, '/api/notes');
  const retro = board.body.notes.find((note) => note.title === 'Retro');
  const opened = await call(bystander, `/api/notes/${retro.id}`);

  await call(bystander, `/api/notes/${retro.id}`, {
    method: 'PATCH',
    body: { blocks: [{ type: 'paragraph', text: 'edited in notes', marks: [] }], version: opened.body.note.version },
  });
  await waitFor(1);

  check('editing it here tells the app that wrote it', received.length === 1, String(received.length));

  const delivered = JSON.parse(received[0]?.body ?? '{}');
  check("with the app's own identifier, so it knows which of its notes",
    delivered.note?.externalId === 'talk-note-99');
  check('and the new text', delivered.note?.blocks?.[0]?.text === 'edited in notes');

  const expected = `sha256=${createHmac('sha256', secret).update(received[0]?.body ?? '').digest('hex')}`;
  check('signed with the secret the app was given', received[0]?.signature === expected);

  await call(bystander, `/api/notes/${retro.id}`, { method: 'DELETE' });
  await waitFor(2);
  check('trashing it here tells the app too',
    JSON.parse(received[1]?.body ?? '{}').event === 'note.deleted');

  await call(bystander, `/api/notes/${retro.id}/restore`, { method: 'POST' });
  await waitFor(3);
  check('and so does putting it back',
    JSON.parse(received[2]?.body ?? '{}').event === 'note.updated');

  await new Promise((resolve) => { receiver.close(resolve); });
}

section('taking a key away');
{
  const keys = await call(dev, '/api/keys');
  const acme = keys.body.keys.find((key) => key.appName === 'Acme CRM');

  const revoked = await call(dev, `/api/keys/${acme.id}`, { method: 'DELETE' });
  check('a key can be revoked', revoked.status === 200);
  check('and stops working immediately',
    (await withKey(token, '/api/v1/notes')).status === 401);

  const notes = await call(dev, '/api/notes');
  check("the notes it wrote are still the person's",
    notes.body.notes?.some((note) => note.source?.app === 'Acme CRM'));

  const labels = await call(dev, '/api/labels');
  const label = labels.body.labels.find((row) => row.name === 'Acme CRM');
  check('and its label outlives it, unlocked', label && label.locked === false);
}

await mongoose.disconnect();
report();
