/**
 * Sharing, collaboration and the trail it leaves.
 *
 * The promise being checked: two people can work on one note without either of
 * them losing a paragraph or wondering who changed what.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { call, check, report, seedUser, section, wipe } from './helpers.mjs';

await connectForTests(process.env.MONGODB_URI);
await wipe('notes', 'labels', 'users', 'sessions', 'noteevents');

const ana = await seedUser({ texorId: 'tx-ana', email: 'ana@texor.app', displayName: 'Ana Note' });
const bo = await seedUser({ texorId: 'tx-bo', email: 'bo@texor.app', displayName: 'Bo Reader' });
const kim = await seedUser({ texorId: 'tx-kim', email: 'kim@texor.app', displayName: 'Kim Reviewer' });

const note = await call(ana, '/api/notes', {
  method: 'POST',
  body: { title: 'Launch plan', blocks: [{ type: 'paragraph', text: 'first draft', marks: [] }] },
});
const id = note.body.note.id;

section('sharing one note');
{
  const shared = await call(ana, `/api/notes/${id}/shares`, {
    method: 'POST', body: { email: 'bo@texor.app', role: 'editor' },
  });
  check('a note can be shared with somebody', shared.status === 200, JSON.stringify(shared.body).slice(0, 160));
  check('and the owner sees who has it', shared.body.note?.shares?.[0]?.email === 'bo@texor.app');
  check('with their name filled in from their account', shared.body.note?.shares?.[0]?.name === 'Bo Reader');
  check('and nothing pending about it', shared.body.note?.shares?.[0]?.pending === false);

  const theirs = await call(bo, '/api/notes?scope=shared');
  check('it appears in their Shared list', theirs.body.notes?.some((row) => row.id === id));

  const open = await call(bo, `/api/notes/${id}`);
  check('they can open it', open.status === 200);
  check('as an editor', open.body.note?.role === 'editor' && open.body.note?.canEdit === true);
  check('but not as its owner', open.body.note?.canShare === false);
  check('and cannot see who else it is shared with', open.body.note?.shares === undefined);
}

section('editing it together');
{
  const theirEdit = await call(bo, `/api/notes/${id}`, {
    method: 'PATCH',
    body: { blocks: [{ type: 'paragraph', text: 'second draft', marks: [] }], version: 1 },
  });
  check('an editor can rewrite it', theirEdit.status === 200);
  check('and the note remembers who last did', theirEdit.body.note?.lastEditedBy?.texorId === 'tx-bo');

  // Ana still has version 1 open. This is the exact case that silently ate
  // somebody's paragraph before the note carried a version.
  const clash = await call(ana, `/api/notes/${id}`, {
    method: 'PATCH',
    body: { blocks: [{ type: 'paragraph', text: 'my draft', marks: [] }], version: 1 },
  });
  check('two people editing the same version, and the second is told rather than overwritten',
    clash.status === 409, `HTTP ${clash.status}`);
  check('the refusal names who got there first',
    clash.body.error?.details?.lastEditedBy?.name === 'Bo Reader');
  check('and hands over what the note actually says now',
    clash.body.error?.details?.note?.blocks?.[0]?.text === 'second draft');

  const retried = await call(ana, `/api/notes/${id}`, {
    method: 'PATCH',
    body: { blocks: [{ type: 'paragraph', text: 'agreed draft', marks: [] }], version: 2 },
  });
  check('and against the version that is really there, it saves', retried.status === 200);
}

section('a viewer');
{
  await call(ana, `/api/notes/${id}/shares`, { method: 'POST', body: { email: 'kim@texor.app', role: 'viewer' } });

  const read = await call(kim, `/api/notes/${id}`);
  check('can read the note', read.status === 200 && read.body.note?.role === 'viewer');

  const write = await call(kim, `/api/notes/${id}`, { method: 'PATCH', body: { title: 'mine' } });
  check('and cannot change a word', write.status === 403, `HTTP ${write.status}`);
  check('told plainly, not hidden behind a 404', write.body.error?.code === 'forbidden');

  const shareOn = await call(bo, `/api/notes/${id}/shares`, { method: 'POST', body: { email: 'x@texor.app' } });
  check('an editor cannot share it onwards', shareOn.status === 403, `HTTP ${shareOn.status}`);
}

section('leaving, and being removed');
{
  const self = await call(kim, `/api/notes/${id}/shares/kim@texor.app`, { method: 'DELETE' });
  check('anybody can take themselves off a note', self.status === 200);
  check('and then it is gone from their list',
    (await call(kim, `/api/notes/${id}`)).status === 404);

  const meddling = await call(bo, `/api/notes/${id}/shares/ana@texor.app`, { method: 'DELETE' });
  check('but cannot remove anybody else', meddling.status === 403, `HTTP ${meddling.status}`);
}

section('sharing with somebody who has no account yet');
{
  const pending = await call(ana, `/api/notes/${id}/shares`, {
    method: 'POST', body: { email: 'newcomer@texor.app', role: 'editor' },
  });
  const waiting = pending.body.note.shares.find((share) => share.email === 'newcomer@texor.app');
  check('the share waits for them', waiting?.pending === true);

  // What the sign-in path does: upsert the account, then claim what was left
  // for that address.
  const { User } = await import(`${new URL('../', import.meta.url).pathname.replace(/\/$/, '')}/src/models/User.js`);
  await import(`${new URL('../', import.meta.url).pathname.replace(/\/$/, '')}/src/models/Note.js`);
  const user = await User.upsertFromClaims({
    sub: 'tx-new', email: 'newcomer@texor.app', name: 'New Comer', picture: '',
  });
  await User.claimPendingShares(user);

  const newcomer = await seedUser({ texorId: 'tx-new2', email: 'other@texor.app', displayName: 'Other' });
  check('somebody else still cannot see it', (await call(newcomer, `/api/notes/${id}`)).status === 404);

  const claimed = await mongoose.connection.db.collection('notes').findOne({ _id: new mongoose.Types.ObjectId(id) });
  const row = claimed.shares.find((share) => share.email === 'newcomer@texor.app');
  check('and the first time they sign in, it finds them', row.texorId === 'tx-new');
  check('and they are on the shared-with list for good', claimed.sharedTexorIds.includes('tx-new'));
}

section('sharing a whole label');
{
  const label = await call(ana, '/api/labels', { method: 'POST', body: { name: 'Q3 launch', colour: 'green' } });
  const labelId = label.body.label.id;

  const filed = await call(ana, '/api/notes', {
    method: 'POST', body: { title: 'Budget', blocks: [{ type: 'paragraph', text: 'numbers', marks: [] }], labels: [labelId] },
  });

  const before = await call(kim, `/api/notes/${filed.body.note.id}`);
  check("a note under an unshared label is nobody else's business", before.status === 404);

  await call(ana, `/api/labels/${labelId}/shares`, { method: 'POST', body: { email: 'kim@texor.app', role: 'editor' } });

  const after = await call(kim, `/api/notes/${filed.body.note.id}`);
  check('sharing the label reaches every note filed under it', after.status === 200);
  check('with the role the label was shared at', after.body.note?.role === 'editor');

  const list = await call(kim, '/api/notes?scope=shared');
  check('and they turn up in the Shared list too',
    list.body.notes?.some((row) => row.id === filed.body.note.id));

  const labels = await call(kim, '/api/labels');
  check('the label itself appears in their sidebar',
    labels.body.labels?.some((row) => row.id === labelId && row.role === 'editor'));

  // Opening that label has to show what is in it. Filtering by owner first
  // showed an empty page on a label that was full.
  const inside = await call(kim, `/api/notes?label=${labelId}`);
  check('and opening it shows the notes filed under it',
    inside.body.notes?.some((row) => row.id === filed.body.note.id),
    JSON.stringify(inside.body.notes?.length));

  await call(ana, `/api/labels/${labelId}/shares/kim@texor.app`, { method: 'DELETE' });
  check('unsharing the label takes the notes back',
    (await call(kim, `/api/notes/${filed.body.note.id}`)).status === 404);
}

section('the trail');
{
  const trail = await call(ana, `/api/notes/${id}/activity`);
  check('the activity of a note can be read', trail.status === 200);

  const actions = trail.body.activity.map((event) => event.action);
  check('it records that the note was created', actions.includes('created'));
  check('that it was shared, and with whom',
    trail.body.activity.some((event) => event.action === 'shared' && event.detail === 'bo@texor.app'));
  check('and who edited it',
    trail.body.activity.some((event) => event.action === 'edited' && event.actor.name === 'Bo Reader'));

  // Otherwise the panel is a keylog and the collection is the biggest thing in
  // the database.
  const edits = actions.filter((action) => action === 'edited').length;
  await call(ana, `/api/notes/${id}`, {
    method: 'PATCH', body: { blocks: [{ type: 'paragraph', text: 'again', marks: [] }], version: 3 },
  });
  await call(ana, `/api/notes/${id}`, {
    method: 'PATCH', body: { blocks: [{ type: 'paragraph', text: 'and again', marks: [] }], version: 4 },
  });
  const after = await call(ana, `/api/notes/${id}/activity`);
  check('a burst of typing is one line in the trail, not one per save',
    after.body.activity.filter((event) => event.action === 'edited').length === edits,
    `${edits} → ${after.body.activity.filter((e) => e.action === 'edited').length}`);

  const theirs = await call(bo, `/api/notes/${id}/activity`);
  check('everybody on a note can see its trail', theirs.status === 200);
  check('and nobody else can',
    (await call(kim, `/api/notes/${id}/activity`)).status === 404);
}

section('finding people to share with');
{
  const known = await call(ana, '/api/people?q=bo');
  check('people you already share with are suggested',
    known.body.people?.some((person) => person.email === 'bo@texor.app'));

  const stranger = await call(ana, '/api/people?q=k');
  check('and the product is not a directory of everybody who has an account',
    !stranger.body.people?.some((person) => person.email === 'other@texor.app'),
    JSON.stringify(stranger.body.people));

  const exact = await call(ana, '/api/people?q=other@texor.app');
  check('though an exact address always resolves',
    exact.body.people?.some((person) => person.email === 'other@texor.app'));

  const unknown = await call(ana, '/api/people?q=nobody@elsewhere.test');
  check('even one nobody here has ever used, so a first share can be sent',
    unknown.body.people?.[0]?.email === 'nobody@elsewhere.test');
}

await mongoose.disconnect();
report();
