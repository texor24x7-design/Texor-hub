/**
 * Everyone who works here, as one list.
 *
 * Staff records and workspace members are two collections describing the same
 * humans: a `Staff` row is employment (shift, designation, pay), a `Member` is
 * access (a Texor account and a role). Somebody can be either, or both, and
 * until now they appeared in two sidebar modules with nothing saying so.
 *
 * The merge is computed on read from the link that already exists — `Staff.member`,
 * falling back to a matching email — so it can never drift from the two
 * collections behind it, and nothing had to be migrated.
 */
import Member from '../models/Member.js';
import Staff from '../models/Staff.js';
import { can, roleOf } from './rbac.service.js';

const key = (staff, member) => String(member?._id ?? staff?.member ?? '')
  || (staff?.email || member?.email || '').toLowerCase()
  || `staff:${staff?._id}`;

/** What a role is called, for the badge beside a person's name. */
const roleName = (workspace, role) => roleOf(workspace, role)?.name ?? role;

export async function list(req) {
  const seesAccess = can(req.workspace, req.member, 'team', 'view');

  const [staff, members] = await Promise.all([
    Staff.find({ workspace: req.workspace._id, deletedAt: null })
      .select('name photo designation phone email joinedOn shiftStart shiftEnd active member salaryKind salaryMinor salaryBasis')
      .sort({ name: 1 }).lean(),
    seesAccess ? Member.find({ workspace: req.workspace._id }).sort({ createdAt: 1 }).lean() : [],
  ]);

  const byKey = new Map();
  const add = (k, patch) => byKey.set(k, { ...(byKey.get(k) ?? {}), ...patch });

  for (const row of staff) add(key(row, null), { staff: row });

  // A member joins the row its staff record already points at; otherwise it is
  // matched on email, and otherwise it stands alone — somebody with a login and
  // no employment record yet.
  const claimed = new Map(staff.filter((s) => s.member).map((s) => [String(s.member), key(s, null)]));
  const byEmail = new Map(staff.filter((s) => s.email).map((s) => [s.email.toLowerCase(), key(s, null)]));
  for (const member of members) {
    const k = claimed.get(String(member._id)) ?? byEmail.get((member.email ?? '').toLowerCase()) ?? `member:${member._id}`;
    add(k, { member });
  }

  const people = [...byKey.values()].map(({ staff: s = null, member: m = null }) => ({
    id: s ? String(s._id) : `member:${m._id}`,
    staffId: s ? String(s._id) : null,
    memberId: m ? String(m._id) : null,
    name: s?.name || m?.name || m?.email || 'Unnamed',
    email: s?.email || m?.email || '',
    // Either an uploaded file key or an absolute URL — a Texor Account picture
    // is already a URL. `fileUrl` on the frontend tells them apart.
    photo: s?.photo ?? m?.picture ?? null,
    designation: s?.designation ?? '',
    phone: s?.phone ?? '',
    joinedOn: s?.joinedOn ?? null,
    shiftStart: s?.shiftStart ?? '',
    shiftEnd: s?.shiftEnd ?? '',
    active: s ? s.active : true,
    pay: s?.salaryKind ? { kind: s.salaryKind, amountMinor: s.salaryMinor ?? 0, basis: s.salaryBasis ?? 'days30' } : null,
    access: m ? { role: m.role, roleName: roleName(req.workspace, m.role), status: m.status, hasAccount: Boolean(m.user) } : null,
  }));

  people.sort((a, b) => a.name.localeCompare(b.name));
  return { people, seesAccess };
}
