'use client';

/**
 * The open workspace: its settings, modules and what this member may do.
 *
 * Loaded once per workspace from `GET /api/w/:slug` and replaced whenever a
 * settings screen saves (those endpoints return a fresh bootstrap), so renaming
 * a module updates the sidebar without a reload.
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { workspaceApi } from './api';

export const WorkspaceContext = createContext(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside a workspace.');
  return value;
}

export function useWorkspaceValue(slug, boot, setBoot, user) {
  const api = useMemo(() => workspaceApi(slug), [slug]);
  const byKey = useMemo(() => new Map((boot?.modules ?? []).map((m) => [m.key, m])), [boot]);

  const module = useCallback((key) => byKey.get(key) ?? null, [byKey]);
  const can = useCallback((key, action) => Boolean(boot?.permissions?.[key]?.actions?.includes(action)), [boot]);
  const hidden = useCallback((key) => boot?.hiddenFields?.[key] ?? [], [boot]);
  const href = useCallback((path = '') => `/w/${slug}${path}`, [slug]);

  /** Apply a bootstrap returned by a settings endpoint. */
  const apply = useCallback((next) => {
    if (next?.modules && next?.workspace) setBoot(next);
  }, [setBoot]);

  return useMemo(() => ({
    slug, api, boot, user, workspace: boot?.workspace, member: boot?.member, industry: boot?.industry,
    modules: boot?.modules ?? [], module, can, hidden, href, apply,
    currency: boot?.workspace?.currency ?? 'INR',
    prefs: boot?.workspace?.preferences ?? {},
  }), [slug, api, boot, user, module, can, hidden, href, apply]);
}

/** Which screen a module key opens. */
export function screenFor(module) {
  if (!module) return 'missing';
  if (module.locked) return 'pro';
  if (module.key === 'dashboard') return 'dashboard';
  if (module.document) return 'documents';
  if (['payments', 'staff', 'team', 'settings'].includes(module.key)) return module.key;
  if (module.edition === 'pro') return 'pro';
  return 'records';
}
