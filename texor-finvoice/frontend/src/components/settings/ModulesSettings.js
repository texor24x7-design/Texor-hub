'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical, Plus } from 'lucide-react';
import { Icon, MODULE_ICONS } from '@/components/Icon';
import { Badge, Button, Dialog, Field, Switch, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import { SettingsLayout } from './SettingsLayout';

export function IconPicker({ value, onChange }) {
  return (
    <div className="icon-grid">
      {MODULE_ICONS.map((name) => (
        <button key={name} type="button" aria-pressed={value === name} title={name} onClick={() => onChange(name)}><Icon name={name} /></button>
      ))}
    </div>
  );
}

function Row({ module, onToggle }) {
  const { href, member } = useWorkspace();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: module.key });
  const fixed = ['dashboard', 'settings', 'team'].includes(module.key);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`field-row${module.enabled ? '' : ' hidden-field'}`}>
      <span className="handle" {...attributes} {...listeners} aria-label="Drag to reorder"><GripVertical size={16} /></span>
      <Icon name={module.icon} size={17} />
      <div className="grow">
        <div className="strong">{module.label}</div>
        <div className="tiny subtle">{module.custom ? 'Your module' : 'Built in'} · {module.fields?.filter((f) => f.custom).length ?? 0} custom fields</div>
      </div>
      {module.locked ? <span className="pro-chip">PRO</span> : null}
      {!fixed && !module.locked ? <Switch checked={module.enabled} onChange={(on) => onToggle(module, on)} label={<span className="tiny muted">{module.enabled ? 'On' : 'Off'}</span>} /> : null}
      {!module.locked && module.key !== 'dashboard' && (module.fields?.length || module.custom) ? <Link className="btn btn-ghost btn-sm" href={href(`/settings/modules/${module.key}`)}>Customise<ChevronRight /></Link> : <span style={{ width: 96 }} />}
    </div>
  );
}

export function ModulesSettings() {
  const { api, boot, apply, href } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [all, setAll] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', labelSingular: '', icon: 'blocks', customerLink: true });
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // The bootstrap lists only enabled modules; switched-off ones are needed here to switch them back on.
  useEffect(() => { api.get('/settings/modules/all').then((r) => setAll(r.modules)).catch(() => setAll(boot.modules)); }, [api, boot.modules]);

  async function persistOrder(next) {
    setAll(next);
    try { apply(await api.put('/settings/modules/order', { modules: next.map((m, i) => ({ key: m.key, order: i * 10 })) })); } catch (error) { toast(error.message, 'error'); }
  }

  async function toggle(module, enabled) {
    try {
      const next = await api.put(`/settings/modules/${module.key}`, { enabled });
      apply(next);
      setAll((list) => list.map((m) => (m.key === module.key ? { ...m, enabled } : m)));
      toast(`${module.label} switched ${enabled ? 'on' : 'off'}`);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function create() {
    setBusy(true);
    try {
      const result = await api.post('/settings/modules', { ...form, labelSingular: form.labelSingular || form.label.replace(/s$/, '') });
      apply(result);
      router.push(href(`/settings/modules/${result.key}`));
    } catch (error) { toast(error.message, 'error'); setBusy(false); }
  }

  const visible = all.filter((m) => m.page !== false && m.edition !== 'pro');

  return (
    <SettingsLayout section="modules" title="Modules & fields" description="Rename anything, switch modules on or off, drag to reorder the sidebar, and add modules of your own."
      actions={<Button icon={<Plus />} onClick={() => setCreating(true)}>New module</Button>}>
      <section className="card card-pad">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const from = visible.findIndex((m) => m.key === active.id);
          const to = visible.findIndex((m) => m.key === over.id);
          persistOrder(arrayMove(visible, from, to));
        }}>
          <SortableContext items={visible.map((m) => m.key)} strategy={verticalListSortingStrategy}>
            {visible.map((m) => <Row key={m.key} module={m} onToggle={toggle} />)}
          </SortableContext>
        </DndContext>
        <div className="row small muted" style={{ marginTop: '0.5rem' }}><Badge tone="neutral" plain>Tip</Badge>Line item columns live under <Link href={href('/settings/modules/lines')}>Line items</Link>.</div>
      </section>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New module" description="A module is a list of records with the fields you choose — vehicles, tables, projects, memberships, anything."
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create} loading={busy} disabled={!form.label.trim()}>Create and add fields</Button></>}>
        <div className="stack">
          <div className="grid-2">
            <Field label="Name (plural)" required><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Memberships" autoFocus /></Field>
            <Field label="One of them"><input className="input" value={form.labelSingular} onChange={(e) => setForm({ ...form, labelSingular: e.target.value })} placeholder="Membership" /></Field>
          </div>
          <Switch checked={form.customerLink} onChange={(customerLink) => setForm({ ...form, customerLink })} label="Each record belongs to a customer" />
          <Field label="Icon"><IconPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} /></Field>
        </div>
      </Dialog>
    </SettingsLayout>
  );
}
