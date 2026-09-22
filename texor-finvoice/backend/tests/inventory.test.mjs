/**
 * Stock kept in a spreadsheet, which is where most shops keep it.
 *
 * The round trip is the point: export the products, edit the stock column in
 * Excel, import the same file back, and the counts must land as ledger rows
 * against the products that are already there — not as a second copy of the
 * catalogue.
 */
import writeXlsxFile from 'write-excel-file/node';
import { readSheet } from 'read-excel-file/node';
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-inv', email: 'inv@shop.test', displayName: 'Shop Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Corner Store', industry: 'retail', gstin: '27AAPFU0939F1ZV' } });
const W = `/api/w/${created.body.workspace.slug}`;

const upload = (path, buffer, type) => call(owner, path, { method: 'POST', body: buffer, headers: { 'content-type': type } });
const importRows = (rows, options = {}) => call(owner, `${W}/records/products/import`, { method: 'POST', body: { rows, ...options } });
const products = async (q = '') => (await call(owner, `${W}/records/products?q=${q}&limit=200`)).body.records;
const bySku = async (sku) => (await products()).find((p) => p.sku === sku);

section('reading a file');
{
  const csv = Buffer.from('﻿Name,SKU,Selling price,In stock\r\n"Tata Salt, 1kg",TS1,2800,40\r\n', 'utf8');
  const parsed = await upload(`${W}/records/products/parse`, csv, 'text/csv');
  check('a CSV comes back as rows', parsed.status === 200 && parsed.body.rows.length === 2, parsed.body);
  check('a quoted comma stays inside its cell', parsed.body.rows?.[1]?.[0] === 'Tata Salt, 1kg', parsed.body.rows?.[1]);

  const xlsx = await writeXlsxFile([['Name', 'SKU', 'In stock'], ['Parle-G', 'PG1', 24]]).toBuffer();
  const fromExcel = await upload(`${W}/records/products/parse`, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('an .xlsx is read too', fromExcel.status === 200 && fromExcel.body.rows[1][0] === 'Parle-G', fromExcel.body);
  check('and its numbers arrive as numbers', fromExcel.body.rows[1][2] === 24, fromExcel.body.rows?.[1]);

  // Windows sends this content type for plain CSVs, so the bytes have to decide.
  const mislabelled = await upload(`${W}/records/products/parse`, csv, 'application/vnd.ms-excel');
  check('a CSV labelled as Excel is still read', mislabelled.status === 200, mislabelled.body);

  const rubbish = await upload(`${W}/records/products/parse`, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5]), 'application/vnd.ms-excel');
  check('an old .xls says what to do instead', rubbish.status === 400 && /save it as/i.test(rubbish.body.error.message), rubbish.body);

  const empty = await upload(`${W}/records/products/parse`, Buffer.from('Name,SKU\r\n', 'utf8'), 'text/csv');
  check('a file with only headings is refused', empty.status === 400, empty.body);
}

section('importing stock');
{
  const first = await importRows([
    { name: 'Tata Salt 1kg', sku: 'TS1', priceMinor: 2800, stock: 40 },
    { name: 'Parle-G', sku: 'PG1', priceMinor: 1000, stock: 24 },
  ]);
  check('new products are created with their count', first.body.created === 2 && first.body.updated === 0, first.body);

  const salt = await bySku('TS1');
  check('the count is on the product', salt.stock === 40, salt);
  const ledger = await call(owner, `${W}/products/${salt._id}/stock`);
  check('and it came from the ledger, not a typed-in number', ledger.body.movements.length === 1 && ledger.body.movements[0].reason === 'opening', ledger.body.movements);
}

section('importing the same file again');
{
  const again = await importRows([
    { name: 'Tata Salt 1kg', sku: 'TS1', priceMinor: 3000, stock: 35 },
    { name: 'Parle-G', sku: 'PG1', priceMinor: 1000, stock: 24 },
  ]);
  check('matching rows update instead of duplicating', again.body.updated === 2 && again.body.created === 0, again.body);
  check('the catalogue did not grow', (await products()).length === 2, (await products()).map((p) => p.name));

  const salt = await bySku('TS1');
  check('the new price took', salt.priceMinor === 3000, salt.priceMinor);
  check('a lower count corrects the stock', salt.stock === 35, salt.stock);

  const ledger = await call(owner, `${W}/products/${salt._id}/stock`);
  check('the correction is a ledger row of −5', ledger.body.movements[0].quantity === -5 && ledger.body.movements[0].reason === 'adjustment', ledger.body.movements[0]);

  const unchanged = await call(owner, `${W}/products/${(await bySku('PG1'))._id}/stock`);
  check('a row whose count did not change writes nothing', unchanged.body.movements.length === 1, unchanged.body.movements);
}

section('receiving a delivery');
{
  await importRows([{ name: 'Parle-G', sku: 'PG1', addStock: 12 }]);
  const biscuits = await bySku('PG1');
  check('stock received adds to what is there', biscuits.stock === 36, biscuits.stock);
  const ledger = await call(owner, `${W}/products/${biscuits._id}/stock`);
  check('and is recorded as a purchase', ledger.body.movements[0].reason === 'purchase' && ledger.body.movements[0].quantity === 12, ledger.body.movements[0]);
}

section('what import refuses');
{
  const untracked = await call(owner, `${W}/records/products`, { method: 'POST', body: { name: 'Repair labour', sku: 'LAB', priceMinor: 50000, trackStock: false } });
  check('a product can be created without tracking stock', untracked.status === 201, untracked.body);

  const counted = await importRows([{ name: 'Repair labour', sku: 'LAB', stock: 5 }]);
  check('a count against an untracked product is reported, not silently dropped', counted.body.errors.length === 1 && /stock tracking/i.test(counted.body.errors[0].message), counted.body);

  const noMatch = await importRows([{ name: 'Tata Salt 1kg', sku: 'TS1', priceMinor: 2900 }], { updateExisting: false });
  check('and matching can be turned off when a duplicate is what you want', noMatch.body.created === 1, noMatch.body);
  await call(owner, `${W}/records/products/${(await products()).find((p) => p.priceMinor === 2900)._id}`, { method: 'DELETE' });
}

section('exporting');
{
  const csv = await call(owner, `${W}/records/products/export`, { raw: true });
  const bytes = Buffer.from(await csv.arrayBuffer());
  check('CSV is served as CSV', csv.headers.get('content-type').startsWith('text/csv'), csv.headers.get('content-type'));
  // `fetch` strips the byte-order mark, so the bytes have to be checked, not the text.
  check('carrying the byte-order mark Excel needs to read a ₹', bytes.subarray(0, 3).toString('hex') === 'efbbbf' && bytes.toString('utf8').startsWith('﻿Name'), bytes.subarray(0, 20).toString())

  const res = await call(owner, `${W}/records/products/export?format=xlsx`, { raw: true });
  const buffer = Buffer.from(await res.arrayBuffer());
  check('.xlsx is served as a spreadsheet', res.headers.get('content-disposition').includes('.xlsx') && buffer[0] === 0x50, res.headers.get('content-disposition'));

  const rows = await readSheet(buffer);
  const stockColumn = rows[0].indexOf('In stock');
  const salt = rows.find((r) => r[0] === 'Tata Salt 1kg');
  check('the exported file has the stock column', stockColumn > 0, rows[0]);
  check('and its counts are numbers, not text', salt[stockColumn] === 35, salt?.[stockColumn]);

  // The round trip the whole feature exists for.
  const edited = rows.map((row) => (row[0] === 'Tata Salt 1kg' ? row.map((v, i) => (i === stockColumn ? 60 : v)) : row));
  const back = await upload(`${W}/records/products/parse`, await writeXlsxFile(edited).toBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const headings = back.body.rows[0];
  const asObjects = back.body.rows.slice(1).map((row) => ({
    name: row[headings.indexOf('Name')], sku: row[headings.indexOf('SKU')], stock: row[stockColumn],
  }));
  const reimported = await importRows(asObjects);
  check('an exported file edited in Excel imports straight back', reimported.body.updated === asObjects.length && !reimported.body.errors.length, reimported.body);
  check('and the edited count is what the shelf now says', (await bySku('TS1')).stock === 60, (await bySku('TS1')).stock);
}

await finish();
