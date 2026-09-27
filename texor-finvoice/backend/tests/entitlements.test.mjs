/**
 * What the free edition includes, and where it stops.
 *
 * Finvoice Lite is metered on scale, never on use — so the checks here are as
 * much about what is *not* capped as what is. A business on Lite can raise a
 * thousand invoices; what it cannot do is grow past three people or run a second
 * company for free.
 *
 * Both ceilings have to hold at every door into them: a seat is taken by
 * inviting someone *and* by switching a disabled colleague back on, and a rule
 * that only guards the first is no rule at all.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-ent', email: 'ent@limit.test', displayName: 'Ent Owner' });
const three = await seedUser(db, { texorId: 'tx-ent3', email: 'three@limit.test', displayName: 'Third Person' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Three Seat Co', industry: 'general', gstin: '27AAPFU0939F1ZV' } });
const W = `/api/w/${created.body.workspace.slug}`;

const invite = (email, role = 'sales') => call(owner, `${W}/team/invites`, { method: 'POST', body: { email, role } });
const members = async () => (await call(owner, `${W}/team`)).body.members;

section('the edition says what it allows');
{
  const boot = await call(owner, W);
  check('the app is told the limits rather than guessing them', boot.body.limits?.members === 3 && boot.body.limits.businesses === 1, boot.body.limits);
}

section('three people, and the owner is one of them');
{
  check('the owner already holds a seat', (await members()).length === 1, await members());

  const second = await invite('two@limit.test');
  check('a second joins', second.status === 201, second.body);
  const third = await invite('three@limit.test');
  check('and a third', third.status === 201, third.body);

  const fourth = await invite('four@limit.test');
  check('a fourth is refused', fourth.status === 402, fourth.body);
  check('and told why, in terms of seats rather than errors', /seats are taken/i.test(fourth.body.error.message), fourth.body.error?.message);
  check('with the code the app uses to offer an upgrade', fourth.body.error.code === 'upgrade_required', fourth.body.error?.code);
  check('nobody was added', (await members()).length === 3, (await members()).length);
}

section('an unaccepted invitation still holds its seat');
{
  const pending = (await members()).find((m) => m.email === 'three@limit.test');
  check('the third seat is only an invitation', pending.status === 'invited', pending.status);
  const another = await invite('five@limit.test');
  check('which still counts, so a fourth is refused', another.status === 402, another.body);
}

section('a seat given back can be used again');
{
  // They have to have actually joined: switching on someone who never accepted
  // is refused for its own, older reason.
  await call(three, '/api/workspaces');
  const joined = (await members()).find((m) => m.email === 'three@limit.test');
  check('the third person signs in and takes their seat', joined.status === 'active', joined.status);

  const off = await call(owner, `${W}/team/members/${joined._id}`, { method: 'PATCH', body: { status: 'disabled' } });
  check('someone who has left is switched off', off.body.member?.status === 'disabled', off.body);

  const replacement = await invite('four@limit.test');
  check('their seat is free for the next person', replacement.status === 201, replacement.body);

  // Switching someone back on is the other door into a seat, and it is guarded too.
  const backOn = await call(owner, `${W}/team/members/${joined._id}`, { method: 'PATCH', body: { status: 'active' } });
  check('switching the old one back on is refused, because the seat has gone', backOn.status === 402, backOn.body);
  check('and the refusal is about seats, not about them', /seats are taken/i.test(backOn.body.error.message), backOn.body.error?.message);
}

section('nothing about doing business is capped');
{
  const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Anyone', phone: '9820000777' } });
  const line = { description: 'A thing', quantity: 1, priceMinor: 10000, taxRate: 18 };
  const raised = [];
  for (let i = 0; i < 12; i += 1) {
    const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: customer.body.record._id, lines: [line] } });
    raised.push(draft.status);
  }
  check('a dozen invoices in a row, none of them refused', raised.every((s) => s === 201), raised.filter((s) => s !== 201));
}

section('one business for free');
{
  const second = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'A Second Company', industry: 'retail' } });
  check('a second business is refused on Lite', second.status === 402, second.body);
  check('and says what to do about it', /Pro/.test(second.body.error.message), second.body.error?.message);

  await call(owner, `${W}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });
  const afterPro = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'A Second Company', industry: 'retail' } });
  check('moving the first to Pro frees the free one again', afterPro.status === 201, afterPro.body);

  const third = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'A Third Company', industry: 'retail' } });
  check('but only one at a time stays free', third.status === 402, third.body);
}

section('Pro lifts the seat limit too');
{
  const pro = await call(owner, `${W}`);
  check('a Pro workspace reports no ceiling', pro.body.limits?.members === null, pro.body.limits);
  const sixth = await invite('six@limit.test');
  check('so another person can join', sixth.status === 201, sixth.body);
}

await finish();
