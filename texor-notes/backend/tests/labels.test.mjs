/**
 * Labels — the filing, and the rules that keep it honest.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { call, check, report, seedUser, section, wipe } from './helpers.mjs';

await connectForTests(process.env.MONGODB_URI);
await wipe('notes', 'labels', 'users', 'sessions');

const ana = await seedUser({ texorId: 'tx-ana', email: 'ana@texor.app', displayName: 'Ana Note' });
const bo = await seedUser({ texorId: 'tx-bo', email: 'bo@texor.app', displayName: 'Bo Reader' });

section('making one');
const work = await call(ana, '/api/labels', { method: 'POST', body: { name: 'Work', colour: 'blue' } });
check('a label can be made', work.status === 201, JSON.stringify(work.body).slice(0, 160));
check('with a colour', work.body.label?.colour === 'blue');
check('and it is not locked', work.body.label?.locked === false);

const workId = work.body.label?.id;

section("names are a person's own, and unique to them");
{
  const again = await call(ana, '/api/labels', { method: 'POST', body: { name: 'Work' } });
  check('the same name twice is refused', again.status === 409, `HTTP ${again.status}`);

  // The sidebar bug this prevents: two labels that look identical, with notes
  // split between them depending on which day they were filed.
  const shouty = await call(ana, '/api/labels', { method: 'POST', body: { name: 'WORK' } });
  check('whatever the capitals', shouty.status === 409, `HTTP ${shouty.status}`);

  const elsewhere = await call(bo, '/api/labels', { method: 'POST', body: { name: 'Work' } });
  check('but somebody else may have a label of the same name', elsewhere.status === 201);
}

section('filing notes under it');
{
  const personal = await call(ana, '/api/labels', { method: 'POST', body: { name: 'Personal' } });
  const note = await call(ana, '/api/notes', {
    method: 'POST',
    body: { title: 'Roadmap', blocks: [{ type: 'paragraph', text: 'ship it', marks: [] }] },
  });
  const noteId = note.body.note.id;

  const filed = await call(ana, `/api/notes/${noteId}/labels`, {
    method: 'PUT',
    body: { labels: [workId, personal.body.label.id] },
  });
  check('a note can carry more than one label', filed.body.note?.labels?.length === 2);

  const listed = await call(ana, `/api/notes?label=${workId}`);
  check('and is found under either', listed.body.notes?.some((row) => row.id === noteId));

  // Filing under somebody else's label would share the note with everybody
  // that label is shared with — an escalation, not an untidiness.
  const stolen = await call(bo, '/api/notes', {
    method: 'POST', body: { title: 'theirs', labels: [workId] },
  });
  check('a label somebody else owns is quietly dropped, not honoured',
    stolen.body.note?.labels?.length === 0, JSON.stringify(stolen.body.note?.labels));
}

section('deleting one');
{
  const doomed = await call(ana, '/api/labels', { method: 'POST', body: { name: 'Temporary' } });
  const note = await call(ana, '/api/notes', {
    method: 'POST', body: { title: 'keep me', labels: [doomed.body.label.id] },
  });

  await call(ana, `/api/labels/${doomed.body.label.id}`, { method: 'DELETE' });

  const survivor = await call(ana, `/api/notes/${note.body.note.id}`);
  check('deleting a label leaves its notes alone', survivor.status === 200);
  check('it only unfiles them', survivor.body.note?.labels?.length === 0);
}

section("an app's own label");
{
  const db = mongoose.connection.db;
  const { insertedId } = await db.collection('labels').insertOne({
    ownerTexorId: 'tx-ana', name: 'Acme CRM', colour: 'default',
    shares: [], sharedTexorIds: [], locked: true, apiKey: new mongoose.Types.ObjectId(),
    createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });

  const renamed = await call(ana, `/api/labels/${insertedId}`, { method: 'PATCH', body: { name: 'Mine now' } });
  check('refuses to be renamed', renamed.status === 403, `HTTP ${renamed.status}`);

  const recoloured = await call(ana, `/api/labels/${insertedId}`, { method: 'PATCH', body: { colour: 'pink' } });
  check("but the colour is still the owner's to choose", recoloured.body.label?.colour === 'pink');

  const deleted = await call(ana, `/api/labels/${insertedId}`, { method: 'DELETE' });
  check('and it cannot be deleted while the key lives', deleted.status === 403);
}

section("somebody else's labels");
{
  const mine = await call(ana, '/api/labels');
  check('are not in my list', mine.body.labels?.every((label) => label.owner === 'tx-ana'));

  const theirs = await call(bo, `/api/labels/${workId}`, { method: 'PATCH', body: { name: 'hijacked' } });
  check('and cannot be edited', theirs.status === 404, `HTTP ${theirs.status}`);
}

await mongoose.disconnect();
report();
