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

  /**
   * Remember a word someone just added to a category / unit / role list, so the
   * next field in the same session offers it. The API persists it on save; this
   * only stops the app forgetting it in the meantime.
   */
  const learn = useCallback((fieldKey, moduleKey, word) => {
    const bucket = suggestionBucket(fieldKey, moduleKey);
    const value = String(word ?? '').trim();
    if (!bucket || !value) return;
    setBoot((prev) => {
      if (!prev?.workspace) return prev;
      const prefs = prev.workspace.preferences ?? {};
      const [key, sub] = bucket;
      const current = (sub ? prefs[key]?.[sub] : prefs[key]) ?? [];
      if (current.some((w) => w.toLowerCase() === value.toLowerCase())) return prev;
      const next = [...current, value];
      return {
        ...prev,
        workspace: {
          ...prev.workspace,
          preferences: { ...prefs, [key]: sub ? { ...(prefs[key] ?? {}), [sub]: next } : next },
        },
      };
    });
  }, [setBoot]);

  /** Apply a bootstrap returned by a settings endpoint. */
  const apply = useCallback((next) => {
    if (next?.modules && next?.workspace) setBoot(next);
  }, [setBoot]);

  return useMemo(() => ({
    slug, api, boot, user, workspace: boot?.workspace, member: boot?.member, industry: boot?.industry,
    modules: boot?.modules ?? [], module, can, hidden, href, apply, learn,
    currency: boot?.workspace?.currency ?? 'INR',
    prefs: boot?.workspace?.preferences ?? {},
  }), [slug, api, boot, user, module, can, hidden, href, apply, learn]);
}

/**
 * Where a field's free-text suggestions live in preferences. Shared by the
 * dropdown that reads them and the one that adds to them, so the two can never
 * disagree about which list a word belongs in.
 */
export function suggestionBucket(fieldKey, moduleKey) {
  if (fieldKey === 'category') return ['categories', moduleKey];
  if (fieldKey === 'unit') return ['units'];
  if (fieldKey === 'designation') return ['designations'];
  if (fieldKey === 'mode') return ['paymentModes'];
  return null;
}

/**
 * What to call a record in a list. The module already declares which field is
 * its title, so read that rather than guessing at `name`/`itemName` — a
 * module-backed store like expenses has neither.
 */
export const recordTitle = (module, record) => {
  const field = module?.fields?.find((f) => f.key === module.titleField);
  /**
   * A custom field's value lives in `record.custom`, never at the top level, so
   * probing `record[titleField]` there always missed. And for a reference or a
   * select the raw value is an id or an option key — not anything to show. The
   * API resolves all of that into `record.title` when a record is saved and
   * again whenever the module changes, so that is the one to trust.
   */
  const live = field && !field.custom ? record?.[field.key] : null;
  return live || record?.title || record?.name || record?.itemName || 'Untitled';
};

/** Which screen a module key opens. */
export function screenFor(module) {
  if (!module) return 'missing';
  if (module.locked) return 'pro';
  if (module.key === 'dashboard') return 'dashboard';
  if (module.document) return 'documents';
  if (['payments', 'schedules', 'staff', 'team', 'settings'].includes(module.key)) return module.key;
  if (module.edition === 'pro') return 'pro';
  return 'records';
}
