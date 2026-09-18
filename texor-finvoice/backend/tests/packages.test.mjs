/**
 * Packages: a group of products and services billed by expanding into its parts.
 *
 * The first check is the reason the feature is shaped this way. A bundle sold at
 * one price is a mixed supply under section 8 of the CGST Act and would be
 * taxable in full at the highest rate of any component; billing the parts
 * separately keeps each at its own rate.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';
import { computeDocument } from '../../frontend/src/lib/shared/tax.mjs';
import { linesFromPackage, partsTotal } from '../../frontend/src/lib/shared/packages.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-pkg', email: 'pkg@volt.test', displayName: 'Package Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Combo Co', industry: 'general', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

const product = async (body) => {
  const res = await call(owner, `${W}/records/products`, { method: 'POST', body: { taxRate: 5, trackSerials: false, priceIncludesTax: false, ...body } });
  return res.body.record;
};

const dal = await product({ name: 'Dal makhani', priceMinor: 22000, taxRate: 5, trackStock: true, openingStock: 100 });
const drink = await product({ name: 'Cola 300ml', priceMinor: 6000, taxRate: 28, trackStock: true, openingStock: 100 });
const roti = await product({ name: 'Butter roti', priceMinor: 3000, taxRate: 5, trackStock: false });

section('building a package');
{
  const nested = await call(owner, `${W}/records/packages`, { method: 'POST', body: { name: 'Nope', components: [{ item: dal._id, quantity: 1 }] } });
  const pkgId = nested.body.record._id;
  const inner = await call(owner, `${W}/records/packages`, { method: 'POST', body: { name: 'Outer', components: [{ item: pkgId, quantity: 1 }] } });
  check('a package cannot contain another package', inner.status === 400 && /itself a package/i.test(JSON.stringify(inner.body)), inner.body);

  const empty = await call(owner, `${W}/records/packages`, { method: 'POST', body: { name: 'Nothing', components: [] } });
  check('and cannot be empty', empty.status === 400, empty.body);

  const gone = await call(owner, `${W}/records/packages`, { method: 'POST', body: { name: 'Ghost', components: [{ item: '000000000000000000000000', quantity: 1 }] } });
  check('a component that does not exist is refused', gone.status === 400 && /no longer exists/i.test(JSON.stringify(gone.body)), gone.body);

  const dearer = await call(owner, `${W}/records/packages`, { method: 'POST', body: {
    name: 'Worse deal', packagePricing: 'fixed', priceMinor: 999999,
    components: [{ item: dal._id, quantity: 1 }],
  } });
  check('a package priced above its parts is refused', dearer.status === 400 && /parts come to/i.test(JSON.stringify(dearer.body)), dearer.body);

  await call(owner, `${W}/records/packages/${pkgId}`, { method: 'DELETE' });
}

section('a package keeps every rate');
{
  const made = await call(owner, `${W}/records/packages`, { method: 'POST', body: {
    name: 'Meal combo', packagePricing: 'fixed', priceMinor: 28000,
    components: [{ item: dal._id, quantity: 1 }, { item: roti._id, quantity: 2 }, { item: drink._id, quantity: 1 }],
  } });
  check('a package is created', made.status === 201, made.body);

  const { body: { items } } = await call(owner, `${W}/items?q=Meal combo`);
  const pkg = items.find((i) => i.kind === 'package');
  check('it comes back from the picker as a package', Boolean(pkg), items.map((i) => `${i.name}:${i.kind}`));
  check('with its components resolved to real items', pkg.components.length === 3 && pkg.components.every((c) => c.item?.taxRate != null), pkg.components);

  const lines = linesFromPackage(pkg);
  check('it expands to one line per component', lines.length === 3, lines.length);
  check('each line keeps its own GST rate — never one line at one rate',
    lines.map((l) => l.taxRate).sort((a, b) => a - b).join(',') === '5,5,28', lines.map((l) => l.taxRate));
  check('and its own HSN, so GSTR-1 still groups correctly', lines.every((l) => l.hsn !== undefined), lines.map((l) => l.hsn));

  const computed = computeDocument({ lines, sellerState: '27', placeOfSupply: '27' });
  check('the parts before the saving are what the catalogue says', partsTotal(pkg) === 34000, partsTotal(pkg));
  check('and the package bills at exactly its fixed price', computed.totals.taxableMinor === 28000, computed.totals);
}

section('a price that does not divide evenly');
{
  const odd = await product({ name: 'Odd one', priceMinor: 10001, taxRate: 12 });
  const made = await call(owner, `${W}/records/packages`, { method: 'POST', body: {
    name: 'Awkward', packagePricing: 'fixed', priceMinor: 30000,
    components: [{ item: dal._id, quantity: 1 }, { item: odd._id, quantity: 1 }, { item: drink._id, quantity: 1 }],
  } });
  const { body: { items } } = await call(owner, `${W}/items?q=Awkward`);
  const pkg = items.find((i) => i._id === made.body.record._id);
  const computed = computeDocument({ lines: linesFromPackage(pkg), sellerState: '27', placeOfSupply: '27' });
  check('it still lands on the package price to the paisa', computed.totals.taxableMinor === 30000, computed.totals.taxableMinor);
}

section('a percentage package');
{
  const made = await call(owner, `${W}/records/packages`, { method: 'POST', body: {
    name: 'Ten off', packagePricing: 'percent', packageDiscountPct: 10,
    components: [{ item: dal._id, quantity: 1 }, { item: drink._id, quantity: 1 }],
  } });
  const { body: { items } } = await call(owner, `${W}/items?q=Ten off`);
  const pkg = items.find((i) => i._id === made.body.record._id);
  const lines = linesFromPackage(pkg);
  check('every line carries the same percentage', lines.every((l) => l.discountPct === 10), lines.map((l) => l.discountPct));
  const computed = computeDocument({ lines, sellerState: '27', placeOfSupply: '27' });
  check('and the total is that much off the parts', computed.totals.taxableMinor === 25200, computed.totals.taxableMinor);
}

section('billing one');
{
  const { body: { items } } = await call(owner, `${W}/items?q=Meal combo`);
  const pkg = items.find((i) => i.kind === 'package');
  const customer = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Table 4', phone: '9820000071', stateCode: '27' } });

  const before = { dal: (await call(owner, `${W}/records/products/${dal._id}`)).body.record.stock, drink: (await call(owner, `${W}/records/products/${drink._id}`)).body.record.stock };
  const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: {
    customer: customer.body.record._id, date: new Date().toISOString().slice(0, 10),
    lines: linesFromPackage(pkg, { quantity: 2 }),
  } });
  check('an invoice takes the expanded lines', draft.status === 201 && draft.body.document.lines.length === 3, draft.body);
  check('the exact saving survives the round trip', draft.body.document.lines.some((l) => l.discountAmountMinor > 0), draft.body.document.lines.map((l) => l.discountAmountMinor));
  check('and two packages bill twice the price', draft.body.document.totals.taxableMinor === 56000, draft.body.document.totals);

  const issued = await call(owner, `${W}/documents/invoices/${draft.body.document._id}/issue`, { method: 'POST' });
  check('it issues', issued.status === 200, issued.body);
  const after = { dal: (await call(owner, `${W}/records/products/${dal._id}`)).body.record.stock, drink: (await call(owner, `${W}/records/products/${drink._id}`)).body.record.stock };
  check('each component comes out of stock, multiplied by the package quantity', before.dal - after.dal === 2 && before.drink - after.drink === 2, { before, after });
}

section('the saving survives a conversion');
{
  const { body: { items } } = await call(owner, `${W}/items?q=Meal combo`);
  const pkg = items.find((i) => i.kind === 'package');
  const customer = await call(owner, `${W}/records/customers?q=Table 4`);
  const quote = await call(owner, `${W}/documents/quotations`, { method: 'POST', body: {
    customer: customer.body.records[0]._id, date: new Date().toISOString().slice(0, 10), lines: linesFromPackage(pkg),
  } });
  const converted = await call(owner, `${W}/documents/quotations/${quote.body.document._id}/convert`, { method: 'POST' });
  check('a quotation carrying a package converts', Boolean(converted.body.document), converted.status);
  check('with the exact line discounts intact — the COPIED_LINE_FIELDS trap',
    converted.body.document.totals.taxableMinor === quote.body.document.totals.taxableMinor, {
      quote: quote.body.document.totals.taxableMinor, invoice: converted.body.document.totals.taxableMinor,
    });
}

await finish();
