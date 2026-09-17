/**
 * Members, invitations and roles.
 *
 * Guard rails that hold regardless of what the permission grid says: the owner
 * cannot be removed, demoted or disabled by anyone, only an owner can hand out
 * the owner role, and nobody changes their own role.
 */
import { z } from 'zod';
import Member from '../models/Member.js';
import Staff from '../models/Staff.js';
import Workspace from '../models/Workspace.js';
import ApiError from '../utils/ApiError.js';
import { ACTIONS } from '../modules/registry.js';
import { record as audit } from '../services/audit.service.js';
import { effectiveModules } from '../services/metadata.service.js';
import { bootstrap } from '../services/workspace.service.js';
import env from '../config/env.js';

const roleExists = (workspace, key) => (workspace.roles ?? []).some((r) => r.key === key);

export async function listMembers(req, res) {
  const members = await Member.find({ workspace: req.workspace._id }).sort({ status: 1, createdAt: 1 }).lean();
  res.json({
    members,
    roles: req.workspace.roles,
    inviteLink: `${env.appOrigin}/signin?returnTo=${encodeURIComponent('/')}`,
  });
}

export const inviteSchema = z.object({
  email: z.email('Enter a valid email address.').transform((v) => v.toLowerCase()),
  role: z.string().min(1),
  name: z.string().trim().max(120).default(''),
});

export async function invite(req, res) {
  const { email, role, name } = req.body;
  if (!roleExists(req.workspace, role)) throw ApiError.badRequest('Choose a role.', [{ field: 'role', message: 'Choose a role.' }]);
  if (role === 'owner' && req.member.role !== 'owner') throw ApiError.forbidden('Only the owner can invite another owner.');

  const existing = await Member.findOne({ workspace: req.workspace._id, email }).lean();
  if (existing && existing.status !== 'disabled') {
    throw ApiError.conflict(existing.status === 'invited' ? `${email} is already invited.` : `${email} is already on the team.`, [{ field: 'email', message: 'Already on the team.' }]);
  }

  const member = existing
    ? await Member.findByIdAndUpdate(existing._id, { role, status: existing.user ? 'active' : 'invited', invitedBy: req.user._id }, { returnDocument: 'after' })
    : await Member.create({ workspace: req.workspace._id, email, name, role, status: 'invited', invitedBy: req.user._id });

  await audit(req, { action: 'team.invited', module: 'team', recordId: member._id, summary: `Invited ${email} as ${role}` });
  res.status(201).json({ member });
}

export const memberPatchSchema = z.object({
  role: z.string().min(1).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export async function updateMember(req, res) {
  const member = await Member.findOne({ _id: req.params.id, workspace: req.workspace._id });
  if (!member) throw ApiError.notFound('Member not found.');
  if (String(member._id) === String(req.member._id)) throw ApiError.badRequest('You cannot change your own role or access.');
  if (member.role === 'owner' && req.member.role !== 'owner') throw ApiError.forbidden('Only an owner can change another owner.');
  if (String(member.user) === String(req.workspace.owner)) throw ApiError.badRequest('The workspace creator stays an owner.');

  const { role, status } = req.body;
  if (role) {
    if (!roleExists(req.workspace, role)) throw ApiError.badRequest('Choose a role.');
    if (role === 'owner' && req.member.role !== 'owner') throw ApiError.forbidden('Only the owner can make someone an owner.');
    member.role = role;
  }
  if (status) {
    if (status === 'active' && !member.user) throw ApiError.badRequest('This person has not accepted their invitation yet.');
    member.status = status;
  }
  await member.save();
  await audit(req, { action: 'team.updated', module: 'team', recordId: member._id, summary: `Changed ${member.email}`, metadata: req.body });
  res.json({ member });
}

export async function removeMember(req, res) {
  const member = await Member.findOne({ _id: req.params.id, workspace: req.workspace._id });
  if (!member) throw ApiError.notFound('Member not found.');
  if (String(member._id) === String(req.member._id)) throw ApiError.badRequest('You cannot remove yourself.');
  if (member.role === 'owner' || String(member.user) === String(req.workspace.owner)) throw ApiError.badRequest('Owners cannot be removed.');
  await Member.deleteOne({ _id: member._id });
  await Staff.updateMany({ workspace: req.workspace._id, member: member._id }, { member: null });
  await audit(req, { action: 'team.removed', module: 'team', recordId: member._id, summary: `Removed ${member.email}` });
  res.json({ ok: true });
}

// ── roles ─────────────────────────────────────────────────────────────────────

const grant = z.object({ actions: z.array(z.enum(ACTIONS)).max(ACTIONS.length), scope: z.enum(['all', 'own']).default('all') });

export const roleSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).default(''),
  permissions: z.record(z.string().max(40), grant),
  hiddenFields: z.record(z.string().max(40), z.array(z.string().max(40)).max(100)).default({}),
});

async function saveRoles(req, roles) {
  const workspace = await Workspace.findOneAndUpdate(
    { _id: req.workspace._id, metadataVersion: req.workspace.metadataVersion },
    { $set: { roles }, $inc: { metadataVersion: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!workspace) throw ApiError.conflict('Roles changed a moment ago. Reload and try again.');
  return workspace;
}

function cleanPermissions(workspace, permissions) {
  const known = new Set([...effectiveModules(workspace).map((m) => m.key), 'custom', '*']);
  return Object.fromEntries(Object.entries(permissions).filter(([key]) => known.has(key)));
}

export async function createRole(req, res) {
  const key = `role_${Date.now().toString(36)}`;
  const role = { key, system: false, ...req.body, permissions: cleanPermissions(req.workspace, req.body.permissions) };
  const workspace = await saveRoles(req, [...req.workspace.roles, role]);
  await audit(req, { action: 'team.role_created', module: 'team', summary: `Created role ${role.name}` });
  res.status(201).json({ role, ...bootstrap(workspace, req.member, req.user) });
}

export async function updateRole(req, res) {
  if (req.params.key === 'owner') throw ApiError.badRequest('The owner role always has full access.');
  const roles = req.workspace.roles.map((r) => (r.key === req.params.key
    ? { ...r, ...req.body, permissions: cleanPermissions(req.workspace, req.body.permissions) }
    : r));
  if (!roles.some((r) => r.key === req.params.key)) throw ApiError.notFound('Role not found.');
  const workspace = await saveRoles(req, roles);
  await audit(req, { action: 'team.role_updated', module: 'team', summary: `Updated role ${req.body.name}` });
  res.json(bootstrap(workspace, req.member, req.user));
}

export async function deleteRole(req, res) {
  const role = req.workspace.roles.find((r) => r.key === req.params.key);
  if (!role) throw ApiError.notFound('Role not found.');
  if (role.system) throw ApiError.badRequest('Built-in roles can be edited but not deleted.');
  const inUse = await Member.countDocuments({ workspace: req.workspace._id, role: role.key });
  if (inUse) throw ApiError.conflict(`${inUse} ${inUse === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`);
  const workspace = await saveRoles(req, req.workspace.roles.filter((r) => r.key !== role.key));
  await audit(req, { action: 'team.role_deleted', module: 'team', summary: `Deleted role ${role.name}` });
  res.json(bootstrap(workspace, req.member, req.user));
}
