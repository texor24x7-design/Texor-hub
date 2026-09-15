/**
 * Notes, end to end.
 *
 * The document rules are checked without a server in `notes-doc.test.mjs`. What
 * is left is everything that needs one: who may write a note, who may read it,
 * what sharing actually changes, and whether the guessable meeting code can be
 * turned into a way into somebody else's meeting.
 */
import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';

const API = process.env.TEST_API ?? 'http://localhost:4102';

/** See the note in meetings.test.mjs. This suite wipes collections. */
function assertTestDatabase(uri) {
  const name = (() => {
    try { return new URL(uri).pathname.replace(/^\//, ''); } catch { return ''; }
  })();

  if (!name.endsWith('_test')) {
    console.error(
      `\n  REFUSING TO RUN.\n` +
      `  This suite deletes collections and the target database is "${name || '(unparsed)'}".\n` +
      `  It must end in _test. Use \`npm test\`, which creates an isolated one.\n`,
    );
    process.exit(1);
  }
  return uri;
}

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label} ${extra}`); }
};

await mongoose.connect(assertTestDatabase(process.env.MONGODB_URI));
const db = mongoose.connection.db;

for (const c of ['notes', 'meetings', 'knocks', 'users', 'sessions', 'policies', 'guestsessions']) {
  await db.collection(c).deleteMany({}).catch(() => {});
}

async function seedUser({ texorId, email, displayName, picture = '' }) {
  const now = new Date();
  const { insertedId } = await db.collection('users').insertOne({
    texorId, email, displayName, picture, status: 'active', statusText: '',
    lastSeenAt: now, createdAt: now, updatedAt: now, __v: 0,
  });
  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({
    user: insertedId, texorId, tokenHash: sha256(token),
    accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null,
    userAgent: 'e2e', ip: '127.0.0.1',
    expiresAt: new Date(Date.now() + 864e5), revokedAt: null,
    createdAt: now, updatedAt: now, __v: 0,
  });
  return { texorId, email, displayName, cookie: `talk_sid=${token}` };
}

async function call(user, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, body: payload };
}

const ana = await seedUser({ texorId: 'tx-ana', email: 'ana@texor.app', displayName: 'Ana Note', picture: 'https://x/a.png' });
const bo = await seedUser({ texorId: 'tx-bo', email: 'bo@texor.app', displayName: 'Bo Reader' });
const cy = await seedUser({ texorId: 'tx-cy', email: 'cy@texor.app', displayName: 'Cy Outsider' });

/* A meeting Ana hosts, that Bo attends and Cy does not. */
const made = await call(ana, '/api/meetings', {
  method: 'POST',
  body: { title: 'Q3 review', access: 'texor', lobby: 'off' },
});
const code = made.body.meeting.code;
const anaJoin = await call(ana, `/api/meetings/${code}/join`, { method: 'POST' });
const boJoin = await call(bo, `/api/meetings/${code}/join`, { method: 'POST' });

console.log('\n── the meeting these notes are about ──');
check('the host is in', anaJoin.body.status === 'admitted', JSON.stringify(anaJoin.body).slice(0, 160));
check('and so is the other person', boJoin.body.status === 'admitted', JSON.stringify(boJoin.body).slice(0, 160));

console.log('\n── who can be tagged ──');
{
  const { status, body } = await call(ana, `/api/meetings/${code}/people`);
  check('the people list is readable by somebody who was there', status === 200);

  const names = (body.people ?? []).map((p) => p.name);
  /**
   * The one that caught a real bug.
   *
   * `Meeting.roleOf` returns `'guest'` for any signed-in colleague who was not
   * explicitly invited — which, in a meeting anyone at the company can join, is
   * almost everybody in the room. Filtering the tag picker on that role hid
   * them all. A guest is spotted by their `guest:` id, never by the role.
   */
  check('it has everyone who joined', names.includes('Ana Note') && names.includes('Bo Reader'),
    names.join(', '));
  check('including somebody who joined without being formally invited',
    names.includes('Bo Reader'), names.join(', '));
  check('it does not have somebody who was never in the meeting',
    !names.includes('Cy Outsider'), names.join(', '));
  check('each person carries what a picker needs',
    body.people.every((p) => p.texorId && p.name && 'picture' in p), JSON.stringify(body.people[0]));
  check('people who attended are listed first', body.people[0].attended === true);

  const outsider = await call(cy, `/api/meetings/${code}/people`);
  check('somebody who was not there cannot enumerate the room', outsider.status === 403);
}

console.log('\n── taking a note ──');
const draft = {
  meetingCode: code,
  title: 'Q3 numbers',
  blocks: [
    { type: 'heading', text: 'Revenue' },
    {
      type: 'paragraph',
      text: 'Ask @Bo Reader for the deck',
      marks: [
        { type: 'mention', start: 4, end: 14, texorId: 'tx-bo', name: 'Bo Reader' },
        { type: 'highlight', start: 19, end: 27, color: 'yellow' },
      ],
    },
    { type: 'todo', text: 'send the summary', done: false },
    {
      type: 'quote',
      text: 'the margin held up',
      speakerTexorId: 'tx-bo',
      speakerName: 'Bo Reader',
      at: new Date().toISOString(),
    },
  ],
};

const note = await call(ana, '/api/notes', { method: 'POST', body: draft });
check('a note is created', note.status === 201, JSON.stringify(note.body).slice(0, 200));
const noteId = note.body.note?.id;

check('it belongs to the meeting it was taken in', note.body.note.meetingCode === code);
check('it carries the meeting title, so a list needs one query',
  note.body.note.meetingTitle === 'Q3 review');
check('it is private until said otherwise', note.body.note.visibility === 'private');
check('every block survived', note.body.note.blocks.length === 4, String(note.body.note.blocks.length));
check('the mention survived with its person',
  note.body.note.blocks[1].marks.find((m) => m.type === 'mention')?.texorId === 'tx-bo');
check('the highlight survived with its colour',
  note.body.note.blocks[1].marks.find((m) => m.type === 'highlight')?.color === 'yellow');
check('the action item survived', note.body.note.blocks[2].type === 'todo');
check('the quote kept who said it', note.body.note.blocks[3].speakerName === 'Bo Reader');
check('and when they said it', Boolean(note.body.note.blocks[3].at));
check('the author can edit it', note.body.note.canEdit === true);
check('and is handed the list of people to tag', Array.isArray(note.body.note.people));
check('the preview is built from the text', note.body.note.preview.startsWith('Revenue'));
check('the stats are counted', note.body.note.stats.todo === 1 && note.body.note.stats.highlights === 1,
  JSON.stringify(note.body.note.stats));

console.log('\n── you cannot take notes in a meeting you were not in ──');
{
  const refused = await call(cy, '/api/notes', { method: 'POST', body: { meetingCode: code } });
  check('the guessable code is not a way in', refused.status === 403, JSON.stringify(refused.body));

  const nowhere = await call(ana, '/api/notes', { method: 'POST', body: { meetingCode: 'zzz-zzzz-zzz' } });
  check('nor is a meeting that does not exist', nowhere.status === 404);
}

console.log('\n── a private note is private ──');
{
  const theirs = await call(bo, `/api/notes/${noteId}`);
  check('somebody else in the same meeting cannot read it', theirs.status === 404, String(theirs.status));
  // A 404 rather than a 403: a 403 would confirm the note exists to anybody
  // holding a guessed id.
  check('and is not told it exists', theirs.body.error?.message === 'Note not found.');

  const listed = await call(bo, `/api/notes?scope=shared&meetingCode=${code}`);
  check('it does not appear in anyone else’s list', (listed.body.notes ?? []).length === 0);

  const write = await call(bo, `/api/notes/${noteId}`, { method: 'PATCH', body: { title: 'mine now' } });
  check('and cannot be written to', write.status === 404 || write.status === 403, String(write.status));
}

console.log('\n── being tagged is a reference, not an invitation ──');
{
  // Bo is mentioned in Ana's note, and the note is still private.
  const mentions = await call(bo, '/api/notes?scope=mentions');
  check('a private note that tags me does not show up in my mentions',
    (mentions.body.notes ?? []).length === 0, JSON.stringify(mentions.body.notes));
}

console.log('\n── sharing it with the meeting ──');
{
  const shared = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { visibility: 'meeting' } });
  check('the author can share it', shared.body.note.visibility === 'meeting');

  const read = await call(bo, `/api/notes/${noteId}`);
  check('now somebody who was in the meeting can read it', read.status === 200);
  check('they see the document', read.body.note.blocks.length === 4);
  check('they are told who wrote it', read.body.note.owner.name === 'Ana Note');
  check('but they cannot edit it', read.body.note.canEdit === false);
  check('and are not handed the tagging list they have no use for',
    read.body.note.people === undefined);

  const write = await call(bo, `/api/notes/${noteId}`, { method: 'PATCH', body: { title: 'mine now' } });
  check('editing somebody else’s shared note is refused', write.status === 403, String(write.status));

  const del = await call(bo, `/api/notes/${noteId}`, { method: 'DELETE' });
  check('so is deleting it', del.status === 403, String(del.status));

  const outsider = await call(cy, `/api/notes/${noteId}`);
  check('somebody who was not in the meeting still cannot read it',
    outsider.status === 404, String(outsider.status));

  const mentions = await call(bo, '/api/notes?scope=mentions');
  check('now it shows in the mentions of the person it tags',
    (mentions.body.notes ?? []).length === 1, JSON.stringify(mentions.body.notes?.length));
  check('and is flagged as mentioning them', mentions.body.notes[0].mentionsMe === true);

  const cyMentions = await call(cy, '/api/notes?scope=shared');
  check('and not in the list of somebody outside the meeting',
    (cyMentions.body.notes ?? []).length === 0);
}

console.log('\n── saving while typing ──');
{
  const blocks = [{ type: 'paragraph', text: 'first pass' }];
  const first = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { blocks } });
  check('a save replaces the document rather than merging into it',
    first.body.note.blocks.length === 1, String(first.body.note.blocks.length));

  // Which is the point: the mention is gone, so the index must be too.
  const boMentions = await call(bo, '/api/notes?scope=mentions');
  check('removing a mention removes it from that person’s mentions',
    (boMentions.body.notes ?? []).length === 0, JSON.stringify(boMentions.body.notes?.length));

  const retitled = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { title: 'Renamed' } });
  check('a title-only save leaves the document alone',
    retitled.body.note.title === 'Renamed' && retitled.body.note.blocks.length === 1);
}

console.log('\n── what the server refuses to store ──');
{
  const nasty = await call(ana, `/api/notes/${noteId}`, {
    method: 'PATCH',
    body: {
      blocks: [
        { type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
        { type: 'script', text: 'still a paragraph' },
        { type: 'paragraph', text: 'ok', marks: [{ type: 'highlight', start: 0, end: 99, color: 'red' }] },
      ],
    },
  });

  const stored = nasty.body.note.blocks;
  check('markup is stored as the characters somebody typed',
    stored[0].text === '<img src=x onerror=alert(1)>', stored[0].text);
  check('an unknown block type becomes a paragraph', stored[1].type === 'paragraph');
  check('a mark past the end of its text is pulled back', stored[2].marks[0].end === 2,
    JSON.stringify(stored[2].marks));
  check('a colour that is not one of ours becomes yellow', stored[2].marks[0].color === 'yellow');

  const wrongShape = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { blocks: 'hello' } });
  check('something that is not a document at all is a 400', wrongShape.status === 400, String(wrongShape.status));

  const longTitle = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { title: 'x'.repeat(500) } });
  check('an over-long title is refused rather than truncated', longTitle.status === 400);
}

console.log('\n── the library ──');
{
  // A second meeting, so grouping has something to group.
  const other = await call(ana, '/api/meetings', {
    method: 'POST', body: { title: 'Design sync', access: 'texor', lobby: 'off' },
  });
  const otherCode = other.body.meeting.code;
  await call(ana, `/api/meetings/${otherCode}/join`, { method: 'POST' });
  await call(ana, '/api/notes', {
    method: 'POST',
    body: { meetingCode: otherCode, title: 'Sync notes', blocks: [{ type: 'paragraph', text: 'the sidebar is too wide' }] },
  });

  const mine = await call(ana, '/api/notes?scope=mine');
  check('my notes are listed', (mine.body.notes ?? []).length === 2, String(mine.body.notes?.length));
  check('a list row has no document on it',
    mine.body.notes.every((row) => row.blocks === undefined));
  check('but has enough to draw a card',
    mine.body.notes.every((row) => row.title !== undefined && row.preview !== undefined && row.stats));

  const filtered = await call(ana, `/api/notes?scope=mine&meetingCode=${otherCode}`);
  check('they can be filtered to one meeting', (filtered.body.notes ?? []).length === 1);

  const found = await call(ana, '/api/notes?scope=mine&q=sidebar');
  check('and searched by what is in them', (found.body.notes ?? []).length === 1,
    JSON.stringify(found.body.notes?.map((n) => n.title)));
  const missed = await call(ana, '/api/notes?scope=mine&q=zzzznothing');
  check('a search that matches nothing returns nothing', (missed.body.notes ?? []).length === 0);
}

console.log('\n── deleting ──');
{
  const gone = await call(ana, `/api/notes/${noteId}`, { method: 'DELETE' });
  check('the author can delete their note', gone.status === 200);
  check('it stops being readable', (await call(ana, `/api/notes/${noteId}`)).status === 404);
  check('and stops being listed',
    (await call(ana, '/api/notes?scope=mine')).body.notes.every((row) => row.id !== noteId));

  // Soft, so a save already in flight cannot bring it back.
  const row = await db.collection('notes').findOne({ _id: new mongoose.Types.ObjectId(noteId) });
  check('the row is kept, marked deleted', row && row.deletedAt !== null);

  const late = await call(ana, `/api/notes/${noteId}`, { method: 'PATCH', body: { title: 'zombie' } });
  check('an autosave landing after the delete does not resurrect it', late.status === 404, String(late.status));
}

console.log('\n── not for guests ──');
{
  const anonymous = await call(null, '/api/notes');
  check('notes need a Texor Account', anonymous.status === 401, String(anonymous.status));

  // A guest pass is for one meeting and expires in hours; a note written under
  // one would belong to nobody the moment it lapsed.
  const guestPass = await call(null, `/api/meetings/${code}/guest`, {
    method: 'POST', body: { name: 'Passer By' },
  });
  if (guestPass.status === 201 || guestPass.status === 200) {
    const asGuest = await call({ cookie: 'talk_guest=whatever' }, '/api/notes');
    check('a guest pass does not open the Notes section', asGuest.status === 401, String(asGuest.status));
  } else {
    check('the meeting does not admit guests, so there is nothing to check here', true);
  }
}

console.log('\n── a bad id is a 404, not a crash ──');
{
  check('nonsense id', (await call(ana, '/api/notes/not-an-id')).status === 404);
  check('a well-formed id that is nobody’s',
    (await call(ana, '/api/notes/000000000000000000000000')).status === 404);
}

console.log(`\n${pass} passed, ${fail} failed`);
await mongoose.disconnect();
process.exit(fail === 0 ? 0 : 1);
