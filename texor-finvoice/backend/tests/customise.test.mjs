/**
 * Customising a module has to reach the records, not just the headers.
 *
 * A record's `title` and `searchText` are copies made when it was saved. Picking
 * a different title field changed the column header at once but left every
 * existing record showing the old value, so records saved before the change
 * looked wrong while new ones looked right — reported against the car wash's
 * Vehicles module.
 */
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();
const owner = await seedUser(db, { texorId: 'tx-cust', email: 'cust@volt.test', displayName: 'Wash Owner' });
const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Repro Wash', industry: 'car_wash', gstin: '27AAPFU0939F1ZV', sample: false } });
const W = `/api/w/${created.body.workspace.slug}`;

const vehicles = async () => (await call(owner, `${W}/settings/modules/all`)).body.modules.find((m) => m.key === 'c_vehicles');
const records = async () => (await call(owner, `${W}/records/c_vehicles`)).body.records;

/** Saves the module the way the editor does — order is the array's order. */
async function saveModule(module, { fields, titleField }) {
  const keep = (fields ?? module.fields).filter((f) => !(f.key === 'customer' && !f.custom));
  return call(owner, `${W}/settings/modules/c_vehicles`, {
    method: 'PUT',
    body: {
      label: module.label, labelSingular: module.labelSingular, icon: module.icon,
      titleField: titleField ?? module.titleField, boardField: null, customerLink: module.customerLink,
      fields: keep.map(({ locked, readOnly, refModule, custom, ...f }) => ({ ...f, ...(custom ? { custom, refModule } : {}) })),
    },
  });
}

section('reordering fields');
{
  const before = await vehicles();
  check('the pack ships vehicles in its own order', before.fields.map((f) => f.key).join(' ') === 'customer regNo vehicleType make model color photo notes', before.fields.map((f) => f.key));

  await call(owner, `${W}/records/c_vehicles`, { method: 'POST', body: { custom: { regNo: 'MH12AB1234', vehicleType: 'sedan', make: 'Honda', model: 'City', color: 'White' } } });

  const order = ['color', 'make', 'regNo', 'vehicleType', 'model', 'photo', 'notes'];
  const put = await saveModule(before, { fields: order.map((k) => before.fields.find((f) => f.key === k)) });
  check('the reorder is accepted', put.status === 200, put.body);

  const after = await vehicles();
  check('and the fields come back in the new order', after.fields.map((f) => f.key).join(' ') === `customer ${order.join(' ')}`, after.fields.map((f) => f.key));
  check('with order renumbered from the top', after.fields.filter((f) => f.custom).every((f, i) => f.order === i), after.fields.map((f) => `${f.key}:${f.order}`));

  const [row] = await records();
  check('a record saved before the reorder keeps every value', row.custom.regNo === 'MH12AB1234' && row.custom.color === 'White', row.custom);
}

section('changing which field is the title');
{
  const before = await vehicles();
  const older = (await records())[0];
  check('its title was the registration number', older.title === 'MH12AB1234', older.title);

  const put = await saveModule(before, { titleField: 'model' });
  check('the change is accepted', put.status === 200, put.body);

  // Saved before the change, and never touched since.
  const [refreshed] = await records();
  check('the record saved earlier now reads as its model', refreshed.title === 'City', refreshed.title);

  // And a new one, so both sides agree.
  await call(owner, `${W}/records/c_vehicles`, { method: 'POST', body: { custom: { regNo: 'KA05CD6789', vehicleType: 'suv', make: 'Hyundai', model: 'Creta', color: 'Black' } } });
  const titles = (await records()).map((r) => r.title).sort();
  check('old and new records are titled the same way', titles.join(',') === 'City,Creta', titles);

  const found = (await call(owner, `${W}/records/c_vehicles?q=city`)).body.records;
  check('search follows, so the older record is findable by its new title', found.length === 1 && found[0].custom.regNo === 'MH12AB1234', found.map((r) => r.title));
}

section('what the table renders');
{
  const module = await vehicles();
  const row = (await records()).find((r) => r.custom.regNo === 'MH12AB1234');

  const customerField = module.fields.find((f) => f.key === 'customer');
  check('a customerLink module carries an injected customer field', Boolean(customerField) && customerField.custom === false, customerField);
  check('which is a reference, so it would land in the listable set', customerField.type === 'reference', customerField?.type);

  // The same rule the header and the cells share.
  const values = module.fields.filter((f) => f.custom).map((f) => row.custom?.[f.key]);
  check('every custom value is keyed, never positional', values.includes('MH12AB1234') && values.includes('White'), values);
  check('and the reorder did not move any of them', row.custom.make === 'Honda' && row.custom.model === 'City', row.custom);
}

await finish();
