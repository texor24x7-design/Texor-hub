'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Check, Copy, Paintbrush, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, SkeletonRows, useConfirm, useToast } from '@/components/ui';
import { API_ORIGIN } from '@/lib/api';
import { invalidate, useResource } from '@/lib/data';
import { renderDocument } from '@/lib/shared/render.mjs';
import { sampleDocument } from '@/lib/sample';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

export function useDesignPreviewInputs() {
  const { api, slug, workspace, module } = useWorkspace();
  const { data: catalogue } = useResource(`items-sample:${slug}`, () => api.get('/items', { limit: 3 }));
  return useMemo(() => {
    const invoices = module('invoices');
    const lines = module('lines');
    return {
      business: { ...workspace, branding: workspace.branding, bank: workspace.bank },
      module: { labelSingular: invoices?.labelSingular ?? 'Invoice', fields: invoices?.fields ?? [] },
      lines: { fields: lines?.fields ?? [] },
      document: sampleDocument({ workspace, items: catalogue?.items ?? [], lineFields: lines?.fields ?? [] }),
      assets: { fileUrl: (key) => `${API_ORIGIN}/api/files/${key}`, fontBase: `${API_ORIGIN}/api/fonts` },
    };
  }, [workspace, module, catalogue]);
}

export function DesignThumb({ design, inputs }) {
  const html = useMemo(() => renderDocument({ ...inputs, design, kind: 'invoices', options: { stamp: false } }), [design, inputs]);
  return <div className="design-thumb"><iframe title={`${design.name} preview`} srcDoc={html} sandbox="" tabIndex={-1} loading="lazy" /></div>;
}

export function DesignsSettings() {
  const { api, slug, href, prefs, apply, can } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useResource(`designs:${slug}`, () => api.get('/designs'));
  const inputs = useDesignPreviewInputs();
  const editable = can('settings', 'edit');

  async function makeDefault(key) {
    try { apply(await api.patch('/settings/preferences', { design: key })); invalidate(`designs:${slug}`); toast('Default design changed'); } catch (error) { toast(error.message, 'error'); }
  }
  async function duplicate(key) {
    try { await api.post(`/designs/${key}/duplicate`); reload(); toast('Design duplicated'); } catch (error) { toast(error.message, 'error'); }
  }
  async function remove(design) {
    const ok = await confirm(design.builtin
      ? { title: `Reset ${design.name}?`, message: 'Your changes to this design are discarded.', confirmLabel: 'Reset' }
      : { title: `Delete ${design.name}?`, message: 'Documents that used it switch to Classic.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { apply(await api.del(`/designs/${design.key}`)); reload(); } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <SettingsLayout section="designs" title="Document designs" description="How your quotations and invoices look. Customise every block, label and colour — the preview is exactly what prints.">
      {!data ? <SkeletonRows /> : (
        <div className="grid-3">
          {data.designs.map((design) => {
            const isDefault = (prefs.design ?? 'classic') === design.key;
            return (
              <div key={design.key} className="design-card" aria-pressed={isDefault}>
                <DesignThumb design={design} inputs={inputs} />
                <div className="card-body stack-sm">
                  <div className="row row-between"><strong>{design.name}</strong>{isDefault ? <Badge tone="brand">Default</Badge> : design.edited && design.builtin ? <Badge tone="neutral" plain>Edited</Badge> : null}</div>
                  <p className="small muted" style={{ minHeight: 36 }}>{design.description}</p>
                  {editable ? (
                    <div className="row wrap">
                      <Link className="btn btn-primary btn-sm" href={href(`/settings/designs/${design.key}`)}><Paintbrush />Customise</Link>
                      {!isDefault ? <Button size="sm" variant="secondary" icon={<Check />} onClick={() => makeDefault(design.key)}>Use as default</Button> : null}
                      <Button size="sm" variant="ghost" icon={<Copy />} aria-label="Duplicate" onClick={() => duplicate(design.key)} />
                      {design.edited || !design.builtin ? <Button size="sm" variant="ghost" icon={design.builtin ? <RotateCcw /> : <Trash2 />} aria-label={design.builtin ? 'Reset' : 'Delete'} onClick={() => remove(design)} /> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SettingsLayout>
  );
}
