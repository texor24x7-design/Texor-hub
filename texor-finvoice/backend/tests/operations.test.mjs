/**
 * Everything after the sale: designs and PDFs, sending, warranty claims,
 * attendance, the dashboard and search.
 *
 * The API runs with DELIVERY_DRY_RUN=1, so email and WhatsApp payloads are
 * built in full and stored on the delivery log instead of leaving the machine.
 */
import mongoose from 'mongoose';
import { PNG_1PX } from './fixtures.mjs';
import { call, check, connect, finish, section, seedUser } from './helpers.mjs';

const db = await connect();

const owner = await seedUser(db, { texorId: 'tx-ops-owner', email: 'meera@glow.test', displayName: 'Meera Owner' });
const stylist = await seedUser(db, { texorId: 'tx-ops-staff', email: 'ravi@glow.test', displayName: 'Ravi Stylist' });

const created = await call(owner, '/api/workspaces', { method: 'POST', body: { name: 'Glow Salon', industry: 'salon', gstin: '27AAPFU0939F1ZV', sample: true } });
const W = `/api/w/${created.body.workspace.slug}`;

const logo = await call(owner, `${W}/files?purpose=logo`, { method: 'POST', body: PNG_1PX, headers: { 'content-type': 'image/png' } });
await call(owner, `${W}/settings/business`, { method: 'PATCH', body: { branding: { logo: logo.body.file.key }, bank: { upiId: 'glow@okicici' } } });

const client = await call(owner, `${W}/records/customers`, { method: 'POST', body: { name: 'Anita Rao', phone: '98200 55555', email: 'anita@example.com' } });
const { body: { items } } = await call(owner, `${W}/items?q=facial`);
const draft = await call(owner, `${W}/documents/invoices`, { method: 'POST', body: { customer: client.body.record._id, lines: [{ item: items[0]._id, description: items[0].name, quantity: 1, priceMinor: items[0].priceMinor, taxRate: 5, priceIncludesTax: true }] } });
const invoiceId = draft.body.document._id;

section('designs and PDF');
{
  const designs = await call(owner, `${W}/designs`);
  check('the four built-in designs are offered', designs.body.designs?.length === 4, designs.body);
  check("the salon pack's default design is modern", designs.body.defaultDesign === 'modern');

  const html = await call(owner, `${W}/documents/invoices/${invoiceId}/html`);
  check('a draft renders to HTML', html.status === 200 && typeof html.body === 'string' && html.body.includes('stamp-draft'), String(html.body).slice(0, 200));
  check('the HTML is served under a restrictive CSP', html.headers.get('content-security-policy')?.startsWith("default-src 'none'"));

  const modern = designs.body.designs.find((d) => d.key === 'modern');
  const { key, builtin, edited, ...editable } = modern;
  editable.blocks = [{ id: 'hello', type: 'text', props: { text: 'Hello {{customer.name}}' }, style: { align: 'center' }, when: '' }, ...editable.blocks];
  const saved = await call(owner, `${W}/designs/modern`, { method: 'PUT', body: editable });
  check('a built-in design can be edited', saved.status === 200 && saved.body.designs.find((d) => d.key === 'modern').edited, saved.body);
  const rerendered = await call(owner, `${W}/documents/invoices/${invoiceId}/html`);
  check('and the edit shows on the document', rerendered.body.includes('Hello Anita Rao'));

  const bad = await call(owner, `${W}/designs/modern`, { method: 'PUT', body: { ...editable, blocks: [{ id: 'x', type: 'script', props: {} }] } });
  check('a block type outside the catalogue is refused', bad.status === 400);

  const copy = await call(owner, `${W}/designs/modern/duplicate`, { method: 'POST' });
  check('a design can be duplicated into a custom one', copy.status === 201 && copy.body.designs.length === 5);
  const reset = await call(owner, `${W}/designs/modern`, { method: 'DELETE' });
  check('deleting a built-in resets it', reset.body.designs.find((d) => d.key === 'modern').edited === false);

  const staffHtml = await call(stylist, `${W}/documents/invoices/${invoiceId}/html`);
  check('a stranger cannot render the invoice', staffHtml.status === 404);

  const pdf = await call(owner, `${W}/documents/invoices/${invoiceId}/pdf`, { raw: true });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check('a real PDF comes back', pdf.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 5000, [pdf.status, bytes.length]);

  const fontRes = await call(null, '/api/fonts/inter-latin-ext-400-normal.woff2', { raw: true });
  check('fonts (including the ₹ subset) are served cross-origin', fontRes.status === 200 && fontRes.headers.get('access-control-allow-origin') === '*');
  const traversal = await call(null, '/api/fonts/..%2F..%2Fpackage.json', { raw: true });
  check('the font route cannot be used to read other files', traversal.status === 404);
}

section('sending');
{
  const draftSend = await call(owner, `${W}/documents/invoices/${invoiceId}/deliver`, { method: 'POST', body: { channel: 'whatsapp_link' } });
  check('a draft invoice cannot be sent', draftSend.status === 409);

  const issued = await call(owner, `${W}/documents/invoices/${invoiceId}/issue`, { method: 'POST' });
  check('the invoice is issued', issued.body.document?.status === 'issued', issued.body);

  const link = await call(owner, `${W}/documents/invoices/${invoiceId}/deliver`, { method: 'POST', body: { channel: 'whatsapp_link' } });
  check('click-to-chat needs no setup and adds +91 to a 10-digit number', link.body.url?.startsWith('https://wa.me/919820055555?text='), link.body);
  check('its message links to the public invoice', decodeURIComponent(link.body.url ?? '').includes(`/d/${issued.body.document.publicToken}`));

  const noSmtp = await call(owner, `${W}/documents/invoices/${invoiceId}/deliver`, { method: 'POST', body: { channel: 'smtp' } });
  check('email without a configured sender explains what to set up', noSmtp.status === 400 && noSmtp.body.error.message.includes('SMTP'));

  const smtpNoPass = await call(owner, `${W}/integrations/smtp`, { method: 'PUT', body: { host: 'smtp.zoho.in', port: 465, secure: true, user: 'bills@glow.test', fromEmail: 'bills@glow.test', fromName: 'Glow Salon' } });
  check('SMTP needs a password the first time', smtpNoPass.status === 400);
  const smtp = await call(owner, `${W}/integrations/smtp`, { method: 'PUT', body: { host: 'smtp.zoho.in', port: 465, secure: true, user: 'bills@glow.test', password: 's3cret-pass', fromEmail: 'bills@glow.test', fromName: 'Glow Salon' } });
  check('SMTP is connected', smtp.status === 200, smtp.body);
  check('and the password is never returned', !JSON.stringify(smtp.body).includes('s3cret'));
  const stored = await mongoose.connection.db.collection('integrations').findOne({ type: 'smtp' });
  check('the password is encrypted at rest', stored.secret && !stored.secret.includes('s3cret') && !JSON.stringify(stored.config).includes('s3cret'));

  const email = await call(owner, `${W}/documents/invoices/${invoiceId}/deliver`, { method: 'POST', body: { channel: 'smtp' } });
  check('the invoice is emailed to the customer on file', email.status === 200, email.body);
  const log = await mongoose.connection.db.collection('deliverylogs').findOne({ channel: 'smtp' });
  check('to their address, with the invoice number in the subject', log?.to === 'anita@example.com' && log.subject.includes(issued.body.document.number), log);
  check('with the PDF attached', log?.preview?.raw?.includes('Content-Type: application/pdf'));

  const wa = await call(owner, `${W}/integrations/whatsapp`, { method: 'PUT', body: { phoneNumberId: '1234567890123', accessToken: 'EAAG-test-token-abcdefghijklmnopqrstuvwxyz', templateName: 'invoice_with_pdf', templateLanguage: 'en' } });
  check('WhatsApp Business is connected', wa.status === 200, wa.body);
  const cloud = await call(owner, `${W}/documents/invoices/${invoiceId}/deliver`, { method: 'POST', body: { channel: 'whatsapp_cloud' } });
  check('the invoice goes out as a WhatsApp template', cloud.status === 200, cloud.body);
  const cloudLog = await mongoose.connection.db.collection('deliverylogs').findOne({ channel: 'whatsapp_cloud' });
  const params = cloudLog?.preview?.template?.components?.find((c) => c.type === 'body')?.parameters.map((p) => p.text);
  check('with the PDF in the header and the customer, number and total in the body', cloudLog?.preview?.template?.components?.[0]?.parameters?.[0]?.type === 'document' && params?.[0] === 'Anita Rao' && params?.[2]?.startsWith('₹'), cloudLog?.preview);

  const deliveries = await call(owner, `${W}/documents/invoices/${invoiceId}/deliveries`);
  check('every send is in the delivery log', deliveries.body.deliveries.length === 3);

  const integrations = await call(owner, `${W}/integrations`);
  const boot = await call(owner, W);
  check('whether Gmail can be offered matches what the server is configured with', integrations.body.gmailAvailable === boot.body.features.gmail);
  check('and this test server has no Google client, so it is off', integrations.body.gmailAvailable === false);
  check('no secret appears in the integrations list', !JSON.stringify(integrations.body).includes('EAAG-test'));

  const pub = await call(null, `/api/public/documents/${issued.body.document.publicToken}/pdf`, { raw: true });
  check('the public link serves the PDF', pub.status === 200 && pub.headers.get('content-type') === 'application/pdf');
}

section('staff and attendance');
let staffId;
{
  await call(owner, `${W}/team/invites`, { method: 'POST', body: { email: 'ravi@glow.test', role: 'staff' } });
  await call(stylist, '/api/workspaces');

  const washer = await call(owner, `${W}/records/staff`, { method: 'POST', body: { name: 'Sunil (no account)', designation: 'Beautician', shiftStart: '10:00' } });
  check('a staff member without a Texor account can be added', washer.status === 201, washer.body);
  staffId = washer.body.record._id;
  const ravi = await call(owner, `${W}/records/staff`, { method: 'POST', body: { name: 'Ravi', email: 'ravi@glow.test', designation: 'Stylist', shiftStart: '23:59' } });
  check('a staff member with a matching member email is linked to them', Boolean(ravi.body.record?.member), ravi.body);

  const today = (await call(owner, `${W}/attendance/day`)).body.today;
  const future = await call(owner, `${W}/attendance/${staffId}/2999-01-01`, { method: 'PUT', body: { status: 'present' } });
  check('attendance cannot be marked for the future', future.status === 400);

  const marked = await call(owner, `${W}/attendance/${staffId}/${today}`, { method: 'PUT', body: { status: 'absent', note: 'Called in sick' } });
  check('a manager marks someone absent', marked.body.entry?.status === 'absent', marked.body);

  const staffMark = await call(stylist, `${W}/attendance/${staffId}/${today}`, { method: 'PUT', body: { status: 'present' } });
  check("staff cannot mark other people's attendance", staffMark.status === 403);

  const checkIn = await call(stylist, `${W}/attendance/me/check-in`, { method: 'POST', body: { location: { lat: 18.52, lng: 73.85, accuracy: 20 } } });
  check('a staff member with an account checks themselves in', checkIn.body.entry?.status === 'present' && checkIn.body.entry.source === 'self', checkIn.body);
  // Whether a check-in counts as late depends on the time of day the suite runs,
  // so the rule itself is pinned in `attendance.test.mjs`. What is always true is
  // that a shift starting at 23:59 cannot have been missed yet.
  check('lateness is judged against their shift start, and this one has not begun', checkIn.body.entry.late === false, checkIn.body.entry);
  const twice = await call(stylist, `${W}/attendance/me/check-in`, { method: 'POST', body: {} });
  check('checking in twice is refused', twice.status === 409);
  const out = await call(stylist, `${W}/attendance/me/check-out`, { method: 'POST', body: {} });
  check('and checks out', Boolean(out.body.entry?.checkOut));

  const day = await call(owner, `${W}/attendance/day`);
  check('the day view counts one present and one absent', day.body.counts.present === 1 && day.body.counts.absent === 1, day.body.counts);
  const reg = await call(owner, `${W}/attendance/register?month=${today.slice(0, 7)}`);
  const sunil = reg.body.staff.find((s) => s._id === staffId);
  check('the monthly register has the mark on the right day', sunil.marks[Number(today.slice(8))]?.status === 'absent');
  const csv = await call(owner, `${W}/attendance/register/export?month=${today.slice(0, 7)}`);
  check('the register exports to CSV', typeof csv.body === 'string' && csv.body.includes('Payable days') && csv.body.includes('Sunil'));
}

section('warranty claims');
{
  const off = await call(owner, `${W}/records/warranties`);
  check('warranties start switched off for a salon', off.status === 404);
  const on = await call(owner, `${W}/settings/modules/warranties`, { method: 'PUT', body: { enabled: true } });
  check('and can be switched on', on.body.modules?.some((m) => m.key === 'warranties'), on.body);
  const item = await call(owner, `${W}/records/products`, { method: 'POST', body: { name: 'Hair dryer', priceMinor: 250000, warranty: { duration: 1, unit: 'years', coverage: 'Motor' } } });
  const warranty = await call(owner, `${W}/records/warranties`, { method: 'POST', body: { customer: client.body.record._id, item: item.body.record._id, itemName: 'Hair dryer', serial: 'HD-9', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 365 * 864e5).toISOString() } });
  const id = warranty.body.record._id;
  const claim = await call(owner, `${W}/warranties/${id}/claims`, { method: 'POST', body: { issue: 'Stops after two minutes' } });
  check('a claim is raised', claim.status === 201 && claim.body.warranty.claims.length === 1, claim.body);
  const list = await call(owner, `${W}/records/warranties/${id}`);
  check('the warranty shows an open claim', list.body.record.openClaims === 1);
  const resolved = await call(owner, `${W}/warranties/${id}/claims/${claim.body.warranty.claims[0]._id}`, { method: 'PATCH', body: { status: 'resolved', resolution: 'Motor replaced' } });
  check('and resolved', resolved.body.warranty?.claims[0].status === 'resolved');
  const share = await call(owner, `${W}/warranties/${id}/share`, { method: 'POST' });
  const card = await call(null, `/api/public/warranties/${share.body.token}`);
  check('the warranty card opens publicly', card.status === 200 && card.body.warranty.serial === 'HD-9' && card.body.warranty.state === 'active', card.body);
  check('without the customer\'s phone or internal ids', !JSON.stringify(card.body).includes('98200') && !('_id' in card.body.warranty));
  const voided = await call(owner, `${W}/warranties/${id}/void`, { method: 'POST' });
  const refused = await call(owner, `${W}/warranties/${id}/claims`, { method: 'POST', body: { issue: 'Again' } });
  check('a void warranty takes no claims', voided.status === 200 && refused.status === 409);
}

section('dashboard and search');
{
  await call(owner, `${W}/records/c_appointments`, { method: 'POST', body: { customer: client.body.record._id, custom: { startsAt: new Date().toISOString() } } });
  const dash = await call(owner, `${W}/dashboard`);
  const keys = dash.body.widgets?.map((w) => w.key) ?? [];
  check('the salon dashboard has its appointment board', keys.includes('board:c_appointments'), keys);
  const board = dash.body.widgets.find((w) => w.key === 'board:c_appointments');
  check('which counts the new appointment as booked', board.data.columns.find((c) => c.value === 'booked')?.count === 1);
  const sales = dash.body.widgets.find((w) => w.key === 'sales_today');
  check("today's sales include the issued invoice", sales?.data.count === 1 && sales.data.totalMinor > 0, sales);
  const att = dash.body.widgets.find((w) => w.key === 'attendance_today');
  check('attendance today is summarised', att?.data.present === 1 && att.data.absent === 1, att);

  const staffDash = await call(stylist, `${W}/dashboard`);
  const staffSales = staffDash.body.widgets.find((w) => w.key === 'sales_today');
  check("staff with own-records access see only their own sales, not the owner's", staffSales && staffSales.data.count === 0, staffSales);

  const found = await call(owner, `${W}/search?q=anita`);
  check('search finds the client and her invoice', found.body.results.some((r) => r.module === 'customers') && found.body.results.some((r) => r.module === 'invoices'), found.body);
  const staffFound = await call(stylist, `${W}/search?q=anita`);
  check('search respects roles too', !staffFound.body.results.some((r) => r.module === 'invoices'));
}

await finish();
