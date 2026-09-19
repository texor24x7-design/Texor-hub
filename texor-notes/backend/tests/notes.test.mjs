/**
 * Notes, end to end over real HTTP.
 *
 * The product's promise in one file: what you write is there when you come
 * back, what you throw away can be got back, and what is yours is not
 * anybody else's — including somebody who has guessed an id.
 */
import mongoose from 'mongoose';
import { connectForTests } from './db.mjs';
import { call, check, report, seedUser, section, wipe } from './helpers.mjs';

await connectForTests(process.env.MONGODB_URI);
await wipe('notes', 'labels', 'apikeys', 'users', 'sessions', 'noteevents');

const ana = await seedUser({ texorId: 'tx-ana', email: 'ana@texor.app', displayName: 'Ana Note' });
const bo = await seedUser({ texorId: 'tx-bo', email: 'bo@texor.app', displayName: 'Bo Reader' });

const DOC = [
  { type: 'heading', text: 'Q3 numbers', marks: [], level: 2 },
  {
    type: 'paragraph',
    text: 'Ask @Bo Reader for the deck',
    marks: [
      { type: 'mention', start: 4, end: 14, texorId: 'tx-bo', name: 'Bo Reader' },
      { type: 'highlight', start: 19, end: 27, color: 'yellow' },
    ],
  },
  { type: 'todo', text: 'send the summary', marks: [], done: false },
];

section('writing one down');
const created = await call(ana, '/api/notes', {
  method: 'POST',
  body: { title: 'Q3 review', blocks: DOC, colour: 'yellow' },
});
check('a note can be written', created.status === 201, JSON.stringify(created.body).slice(0, 200));

const id = created.body.note?.id;
check('it comes back with an id', Boolean(id));
check('and the colour it was given', created.body.note?.colour === 'yellow');
check('the author owns it', created.body.note?.role === 'owner' && created.body.note?.canEdit === true);
check('its first version is 1', created.body.note?.version === 1);
check('a private note is shared with nobody', created.body.note?.shares?.length === 0);

section('reading it back');
{
  const read = await call(ana, `/api/notes/${id}`);
  check('it reads back', read.status === 200);
  check('with every block intact', read.body.note?.blocks?.length === 3);
  check('the mention survived the round trip',
    read.body.note?.blocks?.[1]?.marks?.some((m) => m.type === 'mention' && m.texorId === 'tx-bo'));
  check('and the counts are done for the client',
    read.body.note?.stats?.todo === 1 && read.body.note?.stats?.highlights === 1,
    JSON.stringify(read.body.note?.stats));
}

section('markup is text, and stays text');
{
  // The whole reason a note is blocks and ranges rather than HTML.
  const nasty = await call(ana, '/api/notes', {
    method: 'POST',
    body: { title: 'ouch', blocks: [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>', marks: [] }] },
  });
  check('a note full of markup is stored as the characters somebody typed',
    nasty.body.note?.blocks?.[0]?.text === '<img src=x onerror=alert(1)>');
  check('and nothing else rode in with it',
    Object.keys(nasty.body.note.blocks[0]).sort().join() === 'marks,text,type',
    Object.keys(nasty.body.note.blocks[0]).join());
}

section('saving over it');
{
  const saved = await call(ana, `/api/notes/${id}`, {
    method: 'PATCH',
    body: { title: 'Q3 review', blocks: [{ type: 'paragraph', text: 'rewritten', marks: [] }], version: 1 },
  });
  check('a save replaces the document rather than merging into it',
    saved.body.note?.blocks?.length === 1 && saved.body.note.blocks[0].text === 'rewritten');
  check('and moves the version on', saved.body.note?.version === 2);
  check('the mention went with the paragraph it was in',
    saved.body.note?.mentionsMe === false);

  // Two people, one note, one stale copy — the case that silently ate a
  // paragraph before there was a version on it.
  const stale = await call(ana, `/api/notes/${id}`, {
    method: 'PATCH',
    body: { blocks: [{ type: 'paragraph', text: 'from an old tab', marks: [] }], version: 1 },
  });
  check('a save against a version somebody has moved on from is refused',
    stale.status === 409, `HTTP ${stale.status}`);
  check('and the refusal carries the note that is actually there',
    stale.body.error?.details?.note?.blocks?.[0]?.text === 'rewritten');

  const pinned = await call(ana, `/api/notes/${id}`, { method: 'PATCH', body: { pinned: true } });
  check('pinning does not need a version — it cannot lose a word', pinned.status === 200);
  check('and does not pretend the document changed', pinned.body.note?.version === 2);
}

section('the board');
{
  const list = await call(ana, '/api/notes');
  check('lists my notes', list.body.notes?.length === 2, String(list.body.notes?.length));
  check('pinned first', list.body.notes?.[0]?.id === id);
  check('a list row carries no document', list.body.notes?.[0]?.blocks === undefined);
  check('but enough to draw a card',
    typeof list.body.notes?.[0]?.preview === 'string' && typeof list.body.notes?.[0]?.stats === 'object');

  const found = await call(ana, '/api/notes?q=rewritten');
  check('searching finds a word inside a paragraph', found.body.notes?.length === 1);
  const missing = await call(ana, '/api/notes?q=zzzznothing');
  check('and finds nothing when there is nothing', missing.body.notes?.length === 0);
}

section("somebody else's note");
{
  const read = await call(bo, `/api/notes/${id}`);
  check('a stranger holding the id is told it does not exist', read.status === 404, `HTTP ${read.status}`);
  check('in those words, not "forbidden"', read.body.error?.code === 'not_found', JSON.stringify(read.body.error));

  const write = await call(bo, `/api/notes/${id}`, { method: 'PATCH', body: { title: 'mine now' } });
  check('and cannot write to it either', write.status === 404);

  const board = await call(bo, '/api/notes');
  check('it is not on their board', board.body.notes?.length === 0);

  const nobody = await call(null, '/api/notes');
  check('and none of this is readable without signing in', nobody.status === 401, `HTTP ${nobody.status}`);
}

section('archive and trash');
{
  const archived = await call(ana, `/api/notes/${id}`, { method: 'PATCH', body: { archived: true } });
  check('archiving takes a note off the board', archived.body.note?.archived === true);

  const board = await call(ana, '/api/notes');
  check('and the board agrees', board.body.notes?.every((note) => note.id !== id));

  const shelf = await call(ana, '/api/notes?scope=archive');
  check('the archive has it', shelf.body.notes?.some((note) => note.id === id));

  await call(ana, `/api/notes/${id}`, { method: 'PATCH', body: { archived: false } });

  const binned = await call(ana, `/api/notes/${id}`, { method: 'DELETE' });
  check('deleting is moving to the trash', binned.status === 200 && Boolean(binned.body.deletedAt));

  const trash = await call(ana, '/api/notes?scope=trash');
  check('the trash has it', trash.body.notes?.some((note) => note.id === id));

  // The autosave that was already in flight when delete was pressed.
  const late = await call(ana, `/api/notes/${id}`, { method: 'PATCH', body: { title: 'too late' } });
  check('a save landing after the delete does not resurrect it', late.status === 404, `HTTP ${late.status}`);

  const restored = await call(ana, `/api/notes/${id}/restore`, { method: 'POST' });
  check('restoring puts it back where it was', restored.status === 200 && restored.body.note?.deletedAt === null);

  const purgeFirst = await call(ana, `/api/notes/${id}/purge`, { method: 'DELETE' });
  check('a note that is not in the trash refuses to be purged', purgeFirst.status === 400);

  await call(ana, `/api/notes/${id}`, { method: 'DELETE' });
  const purged = await call(ana, `/api/notes/${id}/purge`, { method: 'DELETE' });
  check('from the trash it can be deleted for good', purged.status === 200);
  check('and then it really is gone', (await call(ana, `/api/notes/${id}`)).status === 404);
}

section('nonsense ids are a 404, not a crash');
{
  check('a word where an id belongs', (await call(ana, '/api/notes/banana')).status === 404);
  check("and a well-formed id that is nobody's",
    (await call(ana, `/api/notes/${new mongoose.Types.ObjectId()}`)).status === 404);
}

await mongoose.disconnect();
report();
