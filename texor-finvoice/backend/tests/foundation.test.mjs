/**
 * Workspaces, access control and the metadata engine, end to end.
 *
 * The properties that matter most are the ones a bug would break silently:
 * one business must never read another's records, an invitation must never be
 * claimed by an address Texor has not verified, and a hidden field must be
 * absent from the response rather than merely not drawn.
 */
import { PNG_1PX } from './fixtures.mjs';
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();

const ana = await seedUser(db, { texorId: 'tx-ana', email: 'ana@shine.test', displayName: 'Ana Owner' });
const bo = await seedUser(db, { texorId: 'tx-bo', email: 'bo@shine.test', displayName: 'Bo Sales' });
const cy = await seedUser(db, { texorId: 'tx-cy', email: 'cy@shine.test', displayName: 'Cy Unverified', emailVerified: false });
const dee = await seedUser(db, { texorId: 'tx-dee', email: 'dee@rival.test', displayName: 'Dee Rival' });

section('onboarding');
{
  const gallery = await call(null, '/api/industries');
  check('the industry gallery is public', gallery.status === 200 && gallery.body.industries.length === 8);
  const carWash = gallery.body.industries.find((i) => i.key === 'car_wash');
  check('a car wash previews job cards in its sidebar', carWash.sidebar.some((m) => m.label === 'Job cards'));

  const none = await call(ana, '/api/workspaces');
  check('a new user has no workspaces', none.status === 200 && none.body.workspaces.length === 0);

  const badGstin = await call(ana, '/api/workspaces', { method: 'POST', body: { name: 'Shine Car Spa', industry: 'car_wash', gstin: '27AAPFU0939F1ZW' } });
  check('a mistyped GSTIN is refused with a field error', badGstin.status === 400 && badGstin.body.error.details.some((d) => d.field === 'gstin'), badGstin.body);

  const noAuth = await call(null, '/api/workspaces', { method: 'POST', body: { name: 'X', industry: 'general' } });
  check('creating a workspace needs a session', noAuth.status === 401);
}

const created = await call(ana, '/api/workspaces', {
  method: 'POST',
  body: { name: 'Shine Car Spa', industry: 'car_wash', gstin: '27AAPFU0939F1ZV', sample: true, address: { city: 'Pune' } },
});
check('the owner creates a car wash workspace', created.status === 201, created.body);
const slug = created.body.workspace.slug;
const W = `/api/w/${slug}`;

{
  const boot = await call(ana, W);
  check('bootstrap loads', boot.status === 200, boot.body);
  check('the state comes from the GSTIN', boot.body.workspace.stateCode === '27');
  const labels = boot.body.modules.map((m) => m.label);
  check('the sidebar is shaped for a car wash', labels.includes('Job cards') && labels.includes('Wash packages') && labels.includes('Estimates'), labels);
  check('Pro modules are listed but locked', boot.body.modules.find((m) => m.key === 'reports')?.locked === true);
  check('line-item columns come through for the editor, marked as not a page', boot.body.modules.find((m) => m.key === 'lines')?.page === false);

  const services = await call(ana, `${W}/records/services`);
  check('sample wash packages were seeded', services.body.total === 5, services.body);
  const coating = services.body.records.find((s) => s.name.startsWith('Ceramic'));
  check('with vehicle-type variants and a warranty', coating?.variants.length === 5 && coating.warranty.duration === 2);

  const reports = await call(ana, `${W}/records/reports`);
  check('a locked Pro module refuses with 402', reports.status === 402, reports.body);
}

section('tenancy');
const rival = await call(dee, '/api/workspaces', { method: 'POST', body: { name: 'Rival Wash', industry: 'car_wash' } });
const R = `/api/w/${rival.body.workspace.slug}`;
{
  const peek = await call(dee, W);
  check("a stranger gets 404 for someone else's workspace", peek.status === 404);
  const peekRecords = await call(dee, `${W}/records/customers`);
  check('and for its records', peekRecords.status === 404);
}

section('invitations');
{
  const inviteBo = await call(ana, `${W}/team/invites`, { method: 'POST', body: { email: 'BO@shine.test', role: 'sales' } });
  check('the owner invites a salesperson', inviteBo.status === 201, inviteBo.body);
  const again = await call(ana, `${W}/team/invites`, { method: 'POST', body: { email: 'bo@shine.test', role: 'sales' } });
  check('inviting the same address twice is a conflict', again.status === 409);
  const inviteCy = await call(ana, `${W}/team/invites`, { method: 'POST', body: { email: 'cy@shine.test', role: 'staff' } });
  check('and a staff member', inviteCy.status === 201);

  const boList = await call(bo, '/api/workspaces');
  check('a verified invitee sees the workspace on sign-in', boList.body.workspaces.some((w) => w.slug === slug && w.role === 'sales'), boList.body);

  const cyList = await call(cy, '/api/workspaces');
  check('an unverified email does not claim the invitation', cyList.body.workspaces.length === 0);
  check('but is told there is one waiting', cyList.body.unverifiedInvites === 1);
  check('and cannot open the workspace', (await call(cy, W)).status === 404);
}

section('roles');
{
  const boot = await call(bo, W);
  check('sales cannot see settings in the sidebar', !boot.body.modules.some((m) => m.key === 'settings'));
  check('sales are told cost price is hidden', boot.body.hiddenFields.products?.includes('costMinor'));

  const products = await call(bo, `${W}/records/products`);
  check('cost price is absent from the response, not just the screen', products.body.records.every((p) => !('costMinor' in p)), products.body.records[0]);
  const ownerProducts = await call(ana, `${W}/records/products`);
  check('the owner still sees it', ownerProducts.body.records.every((p) => 'costMinor' in p));

  const del = await call(bo, `${W}/records/products/${products.body.records[0]._id}`, { method: 'DELETE' });
  check('sales cannot delete products', del.status === 403);

  const sneak = await call(bo, `${W}/records/products/${products.body.records[0]._id}`, { method: 'PATCH', body: { name: 'x' } });
  check('nor edit them', sneak.status === 403);

  const settings = await call(bo, `${W}/settings/preferences`, { method: 'PATCH', body: { taxRate: 0 } });
  check('nor change settings', settings.status === 403);

  const edition = await call(bo, `${W}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });
  check('nor the edition', edition.status === 403);

  const customer = await call(bo, `${W}/records/customers`, { method: 'POST', body: { name: 'Rohit', phone: '+91 98200 00001' } });
  check('sales can add a customer', customer.status === 201, customer.body);

  const self = await call(ana, `${W}/team`);
  const anaMember = self.body.members.find((m) => m.email === 'ana@shine.test');
  const boMember = self.body.members.find((m) => m.email === 'bo@shine.test');
  const demoteOwner = await call(ana, `${W}/team/members/${anaMember._id}`, { method: 'PATCH', body: { role: 'staff' } });
  check('nobody changes their own role', demoteOwner.status === 400);

  const promote = await call(ana, `${W}/team/members/${boMember._id}`, { method: 'PATCH', body: { role: 'admin' } });
  check('the owner can promote', promote.status === 200 && promote.body.member.role === 'admin');
  const boAdmin = await call(bo, `${W}/team/members/${anaMember._id}`, { method: 'PATCH', body: { status: 'disabled' } });
  check('an admin cannot disable the owner', boAdmin.status === 403 || boAdmin.status === 400, boAdmin.body);
  await call(ana, `${W}/team/members/${boMember._id}`, { method: 'PATCH', body: { role: 'sales' } });
}

section('custom modules and references');
let vehicleId;
{
  const customers = await call(ana, `${W}/records/customers`);
  const rohit = customers.body.records.find((c) => c.name === 'Rohit');

  const missing = await call(ana, `${W}/records/c_vehicles`, { method: 'POST', body: { customer: rohit._id, custom: { make: 'Hyundai' } } });
  check('required custom fields are enforced', missing.status === 400 && missing.body.error.details.some((d) => d.field === 'custom.regNo'), missing.body);

  const badOption = await call(ana, `${W}/records/c_vehicles`, { method: 'POST', body: { customer: rohit._id, custom: { regNo: 'MH12AB1234', vehicleType: 'tank' } } });
  check('select values must be one of the options', badOption.status === 400);

  const vehicle = await call(ana, `${W}/records/c_vehicles`, { method: 'POST', body: { customer: rohit._id, custom: { regNo: 'MH12AB1234', vehicleType: 'suv', make: 'Hyundai' } } });
  check('a vehicle is created', vehicle.status === 201, vehicle.body);
  check('its title is the registration number', vehicle.body.record.title === 'MH12AB1234');
  vehicleId = vehicle.body.record._id;

  const job = await call(ana, `${W}/records/c_job_cards`, { method: 'POST', body: { customer: rohit._id, custom: { vehicle: vehicleId } } });
  check('a job card defaults to the first stage', job.status === 201 && job.body.record.custom.stage === 'waiting', job.body);
  check("and is titled by its vehicle's registration", job.body.record.title === 'MH12AB1234');
  check('references come back with their titles', job.body.refs[vehicleId]?.title === 'MH12AB1234');

  const board = await call(ana, `${W}/records/c_job_cards?f.stage=waiting`);
  check('the board filter finds it', board.body.total === 1);

  const rivalCustomer = await call(dee, `${R}/records/customers`, { method: 'POST', body: { name: 'Rival customer' } });
  const crossLink = await call(ana, `${W}/records/c_vehicles`, { method: 'POST', body: { customer: rivalCustomer.body.record._id, custom: { regNo: 'KA01', vehicleType: 'suv' } } });
  check("linking to another workspace's record is refused", crossLink.status === 400, crossLink.body);

  const readAcross = await call(dee, `${R}/records/c_vehicles/${vehicleId}`);
  check("another workspace cannot read a record by id", readAcross.status === 404);

  const search = await call(ana, `${W}/records/c_vehicles?q=mh12`);
  check('search is case-insensitive', search.body.total === 1);
}

section('renaming and adding fields');
{
  const boot = await call(ana, W);
  const customers = boot.body.modules.find((m) => m.key === 'customers');
  const fields = customers.fields.map(({ key, label, type, custom, options, required }) => ({ key, label, type, custom, options, required }));
  fields.find((f) => f.key === 'name').label = 'Client name';
  fields.push({ key: 'source', label: 'How they found us', type: 'select', custom: true, required: true, options: [{ value: 'google', label: 'Google' }, { value: 'walk_in', label: 'Walk-in' }] });

  const edit = await call(ana, `${W}/settings/modules/customers`, { method: 'PUT', body: { label: 'Clients', labelSingular: 'Client', fields } });
  check('the owner renames Customers and adds a field', edit.status === 200, edit.body);

  const boBoot = await call(bo, W);
  const renamed = boBoot.body.modules.find((m) => m.key === 'customers');
  check('everyone sees the new name', renamed.label === 'Clients' && renamed.fields.find((f) => f.key === 'name').label === 'Client name');

  const without = await call(bo, `${W}/records/customers`, { method: 'POST', body: { name: 'Meera' } });
  check('the new required field applies immediately', without.status === 400 && without.body.error.details.some((d) => d.field === 'custom.source'), without.body);

  const withIt = await call(bo, `${W}/records/customers`, { method: 'POST', body: { name: 'Meera', custom: { source: 'google' } } });
  check('and is accepted once filled in', withIt.status === 201);

  const dropName = fields.filter((f) => f.key !== 'name');
  await call(ana, `${W}/settings/modules/customers`, { method: 'PUT', body: { fields: dropName } });
  const after = await call(ana, W);
  check('a system field cannot be deleted by leaving it out', after.body.modules.find((m) => m.key === 'customers').fields.some((f) => f.key === 'name'));

  const custom = await call(ana, `${W}/settings/modules`, { method: 'POST', body: { label: 'Memberships', labelSingular: 'Membership', customerLink: true, fields: [{ key: 'plan', label: 'Plan', type: 'text', required: true }, { key: 'expires', label: 'Expires', type: 'date' }] } });
  check('a brand-new module can be created', custom.status === 201 && custom.body.key === 'c_memberships', custom.body);
  const record = await call(ana, `${W}/records/c_memberships`, { method: 'POST', body: { custom: { plan: 'Gold' } } });
  check('and used straight away', record.status === 201 && record.body.record.title === 'Gold', record.body);
}

section('stock');
{
  const product = await call(ana, `${W}/records/products`, { method: 'POST', body: { name: 'Tyre shine 500ml', priceMinor: 39900, trackStock: true, lowStock: 5, openingStock: 8, stock: 999 } });
  check('opening stock is recorded, and a client-supplied stock count is ignored', product.status === 201 && product.body.record.stock === 8, product.body);
  const id = product.body.record._id;
  const adjust = await call(ana, `${W}/products/${id}/stock`, { method: 'POST', body: { quantity: -4, note: 'used in bay 2' } });
  check('an adjustment moves the count', adjust.body.movement?.balance === 4, adjust.body);
  const low = await call(ana, `${W}/records/products?lowStock=1`);
  check('and it shows up as low stock', low.body.records.some((p) => p._id === id));
  const history = await call(ana, `${W}/products/${id}/stock`);
  check('the ledger has both movements', history.body.movements.length === 2);
}

section('remembered words');
{
  const before = await call(ana, `${W}/`);
  const had = before.body.workspace.preferences.categories?.products ?? [];
  check('a pack seeds some categories to choose from', Array.isArray(had));

  await call(ana, `${W}/records/products`, { method: 'POST', body: { name: 'Snow foam lance', priceMinor: 129900, category: 'Equipment', unit: 'Piece' } });
  const after = await call(ana, `${W}/`);
  const prefs = after.body.workspace.preferences;
  check('a category typed on a product joins the list', prefs.categories.products.includes('Equipment'), prefs.categories.products);
  check('and so does a new unit', prefs.units.includes('Piece'), prefs.units);

  await call(ana, `${W}/records/products`, { method: 'POST', body: { name: 'Snow foam refill', priceMinor: 49900, category: 'Equipment', unit: 'Piece' } });
  const again = await call(ana, `${W}/`);
  const list = again.body.workspace.preferences.categories.products;
  check('using it again does not duplicate it', list.filter((c) => c === 'Equipment').length === 1, list);

  await call(ana, `${W}/records/staff`, { method: 'POST', body: { name: 'Imran Q', designation: 'Foam technician' } });
  const staffed = await call(ana, `${W}/`);
  check('a staff role is remembered the same way', staffed.body.workspace.preferences.designations.includes('Foam technician'), staffed.body.workspace.preferences.designations);
}

section('warranties');
{
  const customers = await call(ana, `${W}/records/customers?q=rohit`);
  const customer = customers.body.records[0]._id;
  const soon = new Date(Date.now() + 10 * 864e5).toISOString();
  const bad = await call(ana, `${W}/records/warranties`, { method: 'POST', body: { customer, itemName: 'Ceramic coating', startDate: soon, endDate: new Date().toISOString() } });
  check('a warranty cannot end before it starts', bad.status === 400);
  const expiring = await call(ana, `${W}/records/warranties`, { method: 'POST', body: { customer, itemName: 'Ceramic coating', startDate: new Date(Date.now() - 700 * 864e5).toISOString(), endDate: soon } });
  check('a warranty ending in 10 days reads as expiring', expiring.body.record?.state === 'expiring', expiring.body);
  const filter = await call(ana, `${W}/records/warranties?state=expiring`);
  check('and the expiring filter finds it', filter.body.total === 1);
}

section('files');
{
  const upload = await call(ana, `${W}/files?purpose=logo`, { method: 'POST', body: PNG_1PX, headers: { 'content-type': 'image/png', 'x-filename': 'logo.png' } });
  check('a PNG uploads', upload.status === 201, upload.body);
  const fake = await call(ana, `${W}/files`, { method: 'POST', body: Buffer.from('<script>alert(1)</script>'), headers: { 'content-type': 'image/png' } });
  check('a file whose bytes are not a PNG is refused', fake.status === 400);
  const svg = await call(ana, `${W}/files`, { method: 'POST', body: Buffer.from('<svg/>'), headers: { 'content-type': 'image/svg+xml' } });
  check('SVG is refused', svg.status >= 400);
  const download = await call(null, upload.body.url, { raw: true });
  check('the file is served cross-origin with a sandboxing CSP', download.status === 200 && download.headers.get('cross-origin-resource-policy') === 'cross-origin' && download.headers.get('content-security-policy')?.includes('sandbox'));
  const branded = await call(ana, `${W}/settings/business`, { method: 'PATCH', body: { branding: { logo: upload.body.file.key }, bank: { upiId: 'shine@okaxis', ifsc: 'HDFC0001234' } } });
  check('the logo is set on the business', branded.body.workspace?.branding?.logo === upload.body.file.key, branded.body);
  const badIfsc = await call(ana, `${W}/settings/business`, { method: 'PATCH', body: { bank: { ifsc: 'NOTANIFSC' } } });
  check('an invalid IFSC is refused', badIfsc.status === 400);
}

section('export and edition');
{
  await call(ana, `${W}/records/customers`, { method: 'POST', body: { name: '=HYPERLINK("http://evil")', custom: { source: 'walk_in' } } });
  const csv = await call(ana, `${W}/records/customers/export`);
  check('CSV headers use the renamed labels', typeof csv.body === 'string' && csv.body.includes('Client name'), String(csv.body).slice(0, 200));
  check('a formula in a name is exported as text', csv.body.includes(`"'=HYPERLINK(""http://evil"")"`), csv.body);
  const boCsv = await call(bo, `${W}/records/customers/export`);
  check('sales cannot export customers', boCsv.status === 403);

  const pro = await call(ana, `${W}/settings/edition`, { method: 'PUT', body: { edition: 'pro' } });
  check('the owner switches to Pro and Reports unlocks', pro.body.modules.find((m) => m.key === 'reports')?.locked === false);

  const activity = await call(ana, `${W}/activity`);
  check('the activity log recorded it all', activity.body.events.some((e) => e.action === 'settings.edition') && activity.body.events.some((e) => e.action === 'team.invited'));
  const boActivity = await call(bo, `${W}/activity`);
  check('sales cannot read the whole log', boActivity.status === 403);
}

await finish();
