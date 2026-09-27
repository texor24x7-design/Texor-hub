/**
 * Tables you can sort and act on in bulk.
 *
 * The sort key names a column, never a database path: a table can only sort by
 * a field its own module declares, so the query string cannot reach into the
 * document. Bulk delete is one update — the point of the checks below is that
 * it still honours tenancy, role scope and the soft-delete rule rather than
 * taking a shortcut around them because it touches many rows at once.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-lst', email: 'lst@sort.test', displayName: 'List Owner' });
const seller = await seedUser(db, { texorId: 'tx-lsl', email: 'sam@sort.test', displayName: 'Sam Seller' });

const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Sortable Supplies', industry: 'general', gstin: '27AAPFU0939F1ZV' } });
const W = `/api/w/${created.body.workspace.slug}`;
await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'sam@sort.test', role: 'sales' } });
await call(seller, '/api/workspaces');

const product = async (name, priceMinor, stock) => (await call(owner, `${W}/records/products`, {
  method: 'POST', body: { name, priceMinor, taxRate: 18, trackStock: true, trackSerials: false, priceIncludesTax: false, openingStock: stock },
})).body.record;

const zebra = await product('Zebra cable', 30000, 5);
const apple = await product('Apple charger', 10000, 90);
const mango = await product('Mango case', 20000, 40);

const names = async (query) => (await call(owner, `${W}/records/products?${query}`)).body.records.map((r) => r.name);

section('sorting by a column');
{
  check('by name, A to Z', (await names('sort=name')).join() === 'Apple charger,Mango case,Zebra cable', await names('sort=name'));
  check('and Z to A', (await names('sort=-name')).join() === 'Zebra cable,Mango case,Apple charger', await names('sort=-name'));
  check('by price, cheapest first', (await names('sort=priceMinor')).join() === 'Apple charger,Mango case,Zebra cable', await names('sort=priceMinor'));
  check('by what is on the shelf, most first', (await names('sort=-stock')).join() === 'Apple charger,Mango case,Zebra cable', await names('sort=-stock'));
}

section('a sort key cannot reach past the module');
{
  const injected = await call(owner, `${W}/records/products?sort=workspace`);
  check('an unknown column is ignored rather than obeyed', injected.status === 200 && injected.body.records.length === 3, injected.body.error ?? injected.body.records?.length);

  const dotted = await call(owner, `${W}/records/products?sort=-custom.anything`);
  check('and so is a path dressed up as one', dotted.status === 200 && dotted.body.records.length === 3, dotted.body.error);

  const hidden = await call(owner, `${W}/records/products?sort=-costMinor`);
  check('sorting by a field the module has is fine', hidden.status === 200, hidden.body.error);
}

section('exporting only what was ticked');
{
  const res = await call(owner, `${W}/records/products/export?ids=${apple._id},${mango._id}`, { raw: true });
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  check('the file holds the two that were picked', text.includes('Apple charger') && text.includes('Mango case'), text.slice(0, 80));
  check('and not the one that was not', !text.includes('Zebra cable'), text.slice(0, 200));

  // Asking for ids and naming none that exist must not fall back to everything.
  const nonsense = await call(owner, `${W}/records/products/export?ids=not-an-id`, { raw: true });
  const all = Buffer.from(await nonsense.arrayBuffer()).toString('utf8');
  check('a junk id selects nothing rather than the whole table', !all.includes('Zebra cable') && all.includes('Name'), all.slice(0, 120));
}

section('deleting a selection');
{
  const spare = await product('Spare one', 100, 1);
  const another = await product('Spare two', 100, 1);

  const refused = await call(seller, `${W}/records/products/bulk-delete`, { method: 'POST', body: { ids: [spare._id] } });
  check('a role without delete cannot', refused.status === 403, refused.body);
  check('so it is still there', (await names('sort=name')).includes('Spare one'));

  const empty = await call(owner, `${W}/records/products/bulk-delete`, { method: 'POST', body: { ids: [] } });
  check('an empty selection is refused', empty.status === 400, empty.body);

  const done = await call(owner, `${W}/records/products/bulk-delete`, { method: 'POST', body: { ids: [spare._id, another._id, '000000000000000000000000'] } });
  check('the two that exist are deleted', done.body.deleted === 2, done.body);
  check('and an id that does not is simply not counted', done.body.asked === 3, done.body);

  const left = await names('sort=name');
  check('they are gone from the list', !left.includes('Spare one') && !left.includes('Spare two'), left);
  check('and the rest are untouched', left.length === 3, left);

  const gone = await call(owner, `${W}/records/products/${spare._id}`);
  check('a deleted record reads as not found', gone.status === 404, gone.status);
}

section('another workspace cannot be deleted through it');
{
  const stranger = await seedUser(db, { texorId: 'tx-lso', email: 'other@sort.test', displayName: 'Other Owner' });
  const theirs = await call(stranger, '/api/workspaces', { method: 'POST', body: { name: 'Someone Else Ltd', industry: 'general' } });
  const theirW = `/api/w/${theirs.body.workspace.slug}`;
  const theirProduct = (await call(stranger, `${theirW}/records/products`, { method: 'POST', body: { name: 'Not yours', priceMinor: 500, taxRate: 0 } })).body.record;

  const reach = await call(owner, `${W}/records/products/bulk-delete`, { method: 'POST', body: { ids: [theirProduct._id] } });
  check('ids from another workspace delete nothing', reach.body.deleted === 0, reach.body);
  const still = await call(stranger, `${theirW}/records/products/${theirProduct._id}`);
  check('and the record is still theirs', still.status === 200, still.status);
}

await finish();
