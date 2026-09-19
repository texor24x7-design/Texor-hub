/**
 * One list of people, merged from two collections.
 *
 * `Staff` is employment and `Member` is access; the same human can be in either
 * or both. These pin that the merge shows each person once, keeps both sides,
 * and drops nobody.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';
// The same helper the People list builds its <img src> with.
import { fileUrl } from '../../frontend/src/lib/api.js';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-ppl', email: 'ppl@volt.test', displayName: 'People Owner' });
const joiner = await seedUser(db, { texorId: 'tx-join', email: 'joiner@volt.test', displayName: 'Jo Joiner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'People Co', industry: 'salon', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

const people = async () => (await call(owner, `${W}/people`)).body.people;
const find = (rows, name) => rows.find((p) => p.name === name);

section('the merged list');
{
  await call(owner, `${W}/records/staff`, { method: 'POST', body: { name: 'No Login', designation: 'Washer', shiftStart: '10:00' } });
  await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'joiner@volt.test', role: 'sales' } });

  const rows = await people();
  check('the owner, the invitee and the staff member are all listed', rows.length === 3, rows.map((p) => p.name));

  const noLogin = find(rows, 'No Login');
  check('someone with no login keeps their shift', noLogin?.shiftStart === '10:00', noLogin);
  check('and shows no access', noLogin?.access === null, noLogin?.access);

  const invited = rows.find((p) => p.email === 'joiner@volt.test');
  check('someone with a login but no employment record is still listed', Boolean(invited), rows);
  check('carrying their role and invitation status', invited?.access?.status === 'invited' && invited?.access?.roleName === 'Sales', invited?.access);
  check('and no shift', invited?.shiftStart === '', invited);
}

section('one row per human');
{
  // Matched on email while the invitation is still pending — the link hook only
  // fires for an *active* member, so the fallback is what joins them here.
  await call(owner, `${W}/records/staff`, { method: 'POST', body: { name: 'Jo Joiner', designation: 'Stylist', email: 'joiner@volt.test', shiftStart: '09:30' } });
  const rows = await people();
  check('adding employment to an invitee does not make a second row', rows.length === 3, rows.map((p) => p.name));

  const jo = find(rows, 'Jo Joiner');
  check('the one row carries the employment side', jo?.shiftStart === '09:30' && jo?.designation === 'Stylist', jo);
  check('and the access side', jo?.access?.roleName === 'Sales', jo?.access);
  check('with both ids, so either side can be acted on', Boolean(jo?.staffId) && Boolean(jo?.memberId), jo);

  // Once they accept, the stored link takes over from the email match.
  await call(joiner, '/api/workspaces');
  const after = await people();
  check('still one row once the invitation is accepted', after.length === 3, after.map((p) => p.name));
  check('and now shown as active', find(after, 'Jo Joiner')?.access?.status === 'active', find(after, 'Jo Joiner')?.access);
}

section('where a face comes from');
{
  // `photo` carries two kinds of value: an uploaded file key for someone added
  // by hand, and an absolute URL for someone who signed in with Google, whose
  // picture Texor Accounts stores as lh3.googleusercontent.com/… . Building
  // `/api/files/<that URL>` is what made Google avatars 404.
  const avatar = 'https://lh3.googleusercontent.com/a/ACg8ocLsNI=s96-c';
  await db.collection('members').updateOne({ email: 'joiner@volt.test' }, { $set: { picture: avatar } });
  await db.collection('staffs').updateOne({ name: 'No Login' }, { $set: { photo: 'abc123' } });

  const rows = await people();
  const jo = find(rows, 'Jo Joiner');
  check('a Texor Account picture comes through as the URL it is', jo?.photo === avatar, jo?.photo);
  check('and is used unchanged as an image source', fileUrl(jo.photo) === avatar, fileUrl(jo.photo));

  const uploaded = find(rows, 'No Login');
  check('an uploaded photo is still a bare file key', uploaded?.photo === 'abc123', uploaded?.photo);
  check('which is fetched from the API', fileUrl(uploaded.photo).endsWith('/api/files/abc123'), fileUrl(uploaded.photo));
  check('and nothing at all stays nothing', fileUrl(null) === null, fileUrl(null));
}

section('marking a whole day at once');
{
  const today = (await call(owner, `${W}/attendance/day`)).body.today;
  const rows = (await call(owner, `${W}/attendance/day`)).body.rows;
  check('there are people to mark', rows.length >= 2, rows.length);

  const bulk = await call(owner, `${W}/attendance/day`, { method: 'PUT', body: {
    date: today, marks: rows.map((r) => ({ staff: r.staff._id, status: 'present' })),
  } });
  check('one request marks everyone', bulk.status === 200 && bulk.body.marked === rows.length, bulk.body);

  const after = (await call(owner, `${W}/attendance/day`)).body;
  check('and nobody is left unmarked', after.counts.unmarked === 0, after.counts);
  check('everyone reads as present', after.counts.present === rows.length, after.counts);

  // Marking a day that has not happened is refused here too, not only per person.
  const future = await call(owner, `${W}/attendance/day`, { method: 'PUT', body: {
    date: '2999-01-01', marks: [{ staff: rows[0].staff._id, status: 'present' }],
  } });
  check('a day in the future is refused', future.status === 400, future.body);

  // A status that is not attendance must not be written in bulk either.
  const junk = await call(owner, `${W}/attendance/day`, { method: 'PUT', body: {
    date: today, marks: [{ staff: rows[0].staff._id, status: 'on_holiday_maybe' }],
  } });
  check('an unknown status is refused', junk.status === 400, junk.status);

  const one = await call(owner, `${W}/attendance/day`, { method: 'PUT', body: {
    date: today, marks: [{ staff: rows[0].staff._id, status: 'absent' }],
  } });
  check('marking again overwrites rather than duplicating', one.body.marked === 1, one.body);
  const fixed = (await call(owner, `${W}/attendance/day`)).body;
  check('leaving the rest alone', fixed.counts.absent === 1 && fixed.counts.present === rows.length - 1, fixed.counts);
}

section('who may see what');
{
  const sales = await seedUser(db, { texorId: 'tx-sales-ppl', email: 'salesppl@volt.test', displayName: 'Sam Sales' });
  await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'salesppl@volt.test', role: 'sales' } });
  await call(sales, '/api/workspaces');

  const seen = await call(sales, `${W}/people`);
  check('a role without team access still sees the people', seen.status === 200 && seen.body.people.length > 0, seen.status);
  check('but not what anyone may do', seen.body.people.every((p) => p.access === null) && seen.body.seesAccess === false, seen.body.seesAccess);
}

await finish();
