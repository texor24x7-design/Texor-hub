/**
 * Who may do what in a workspace.
 *
 * A role grants actions per module key, with `'*'` covering every module and
 * `custom` covering every module a person defined. `scope: 'own'` narrows a
 * grant to records the member created. Owners are checked by role key rather
 * than by their permission grid, so no edit to the grid can lock the owner out.
 */
import { ACTIONS, SYSTEM_ROLES, isCustomModuleKey } from '../modules/registry.js';
import ApiError from '../utils/ApiError.js';

export const defaultRoles = () => SYSTEM_ROLES.map((role) => ({ ...structuredClone(role), system: true }));

export function roleOf(workspace, key) {
  return (workspace.roles ?? []).find((r) => r.key === key) ?? null;
}

function grantFor(role, moduleKey) {
  const p = role?.permissions ?? {};
  return p[moduleKey] ?? (isCustomModuleKey(moduleKey) ? p.custom : undefined) ?? p['*'] ?? null;
}

export function can(workspace, member, moduleKey, action) {
  if (!member || member.status !== 'active') return false;
  if (member.role === 'owner') return true;
  const grant = grantFor(roleOf(workspace, member.role), moduleKey);
  return Boolean(grant?.actions?.includes(action));
}

/** 'all', 'own', or null when the action is not granted at all. */
export function scopeOf(workspace, member, moduleKey, action) {
  if (!can(workspace, member, moduleKey, action)) return null;
  if (member.role === 'owner') return 'all';
  return grantFor(roleOf(workspace, member.role), moduleKey)?.scope === 'own' ? 'own' : 'all';
}

export function hiddenFields(workspace, member, moduleKey) {
  if (!member || member.role === 'owner') return [];
  return roleOf(workspace, member.role)?.hiddenFields?.[moduleKey] ?? [];
}

/** Every module → the actions this member holds, for the frontend to hide what it cannot do. */
export function permissionMap(workspace, member, moduleKeys) {
  return Object.fromEntries(moduleKeys.map((key) => [
    key,
    { actions: ACTIONS.filter((action) => can(workspace, member, key, action)), scope: scopeOf(workspace, member, key, 'view') },
  ]));
}

export function assertCan(workspace, member, moduleKey, action) {
  if (!can(workspace, member, moduleKey, action)) {
    throw ApiError.forbidden(`Your role does not allow you to ${action} here.`);
  }
}
