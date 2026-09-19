'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, Lock, MailPlus, MoreHorizontal, Plus, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { Icon } from '@/components/Icon';
import { Alert, Avatar, Badge, Button, Dialog, Field, Menu, MenuItem, PageHeader, SkeletonRows, StatusBadge, Tabs, useConfirm, useToast, CardTable } from '@/components/ui';
import { invalidate, useResource } from '@/lib/data';
import { relative } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';

const ACTION_LABELS = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', export: 'Export', approve: 'Approve' };
const APPROVE_HINTS = { invoices: 'issue & void', quotations: 'send & decide', staff: 'mark others', warranties: 'resolve claims', gst: 'file' };

export function Members({ data, reload }) {
  const { api, slug, can, member: me } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'staff' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const editable = can('team', 'edit');
  const roles = data.roles;

  async function invite() {
    setBusy(true);
    try {
      await api.post('/team/invites', form);
      toast(`Invitation added for ${form.email}`);
      setInviting(false);
      setForm({ email: '', role: 'staff' });
      reload();
    } catch (error) { setErrors({ ...error.fieldErrors, _: error.message }); } finally { setBusy(false); }
  }

  async function update(member, patch) {
    try { await api.patch(`/team/members/${member._id}`, patch); reload(); toast('Updated'); } catch (error) { toast(error.message, 'error'); }
  }

  async function remove(member) {
    if (!(await confirm({ title: `Remove ${member.name || member.email}?`, message: 'They lose access to this workspace immediately. Their past work stays.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api.del(`/team/members/${member._id}`); reload(); invalidate(`records:${slug}:staff`); } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div><h2>People with access</h2><p className="small muted">Everyone signs in with their own Texor account.</p></div>
        {editable ? <Button icon={<MailPlus />} onClick={() => setInviting(true)}>Invite</Button> : null}
      </div>
      <div className="table-wrap">
        <CardTable>
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Joined</th><th className="tight" /></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m._id}>
                <td><div className="row"><Avatar name={m.name || m.email} src={m.picture} /><div><div className="cell-title">{m.name || m.email.split('@')[0]}{m._id === me._id ? <span className="subtle"> (you)</span> : null}</div><div className="cell-sub">{m.email}</div></div></div></td>
                <td>
                  {editable && m.role !== 'owner' && m._id !== me._id ? (
                    <select className="input input-sm" style={{ width: 160 }} value={m.role} onChange={(e) => update(m, { role: e.target.value })} aria-label="Role">
                      {roles.filter((r) => r.key !== 'owner' || me.role === 'owner').map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                  ) : <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'} plain>{roles.find((r) => r.key === m.role)?.name ?? m.role}</Badge>}
                </td>
                <td><StatusBadge status={m.status} /></td>
                <td className="muted small">{m.joinedAt ? relative(m.joinedAt) : 'Not yet'}</td>
                <td>
                  {editable && m.role !== 'owner' && m._id !== me._id ? (
                    <Menu align="right" trigger={({ toggle }) => <Button variant="ghost" size="sm" icon={<MoreHorizontal />} aria-label="Actions" onClick={toggle} />}>
                      {m.status === 'active' ? <MenuItem icon={<UserX />} onClick={() => update(m, { status: 'disabled' })}>Suspend access</MenuItem> : null}
                      {m.status === 'disabled' && m.user ? <MenuItem icon={<ShieldCheck />} onClick={() => update(m, { status: 'active' })}>Restore access</MenuItem> : null}
                      <MenuItem icon={<Trash2 />} danger onClick={() => remove(m)}>Remove</MenuItem>
                    </Menu>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      </div>

      <Dialog open={inviting} onClose={() => setInviting(false)} title="Invite someone" description="They get access the first time they sign in to Finvoice with a Texor account using this email."
        footer={<><Button variant="secondary" onClick={() => setInviting(false)}>Cancel</Button><Button onClick={invite} loading={busy}>Add invitation</Button></>}>
        <div className="stack">
          {errors._ && !errors.email ? <Alert>{errors._}</Alert> : null}
          <Field label="Email" required error={errors.email}><input className="input" type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></Field>
          <Field label="Role" hint={roles.find((r) => r.key === form.role)?.description}>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.filter((r) => r.key !== 'owner' || me.role === 'owner').map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </Field>
          <Alert kind="info">Send them this link to sign in: <span className="mono">{data.inviteLink}</span> <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => { navigator.clipboard?.writeText(data.inviteLink); toast('Link copied'); }} /></Alert>
        </div>
      </Dialog>
    </div>
  );
}

function explicitGrants(role, modules) {
  const p = role.permissions ?? {};
  const grants = {};
  for (const m of modules) {
    const g = p[m.key] ?? (m.custom ? p.custom : undefined) ?? p['*'];
    grants[m.key] = { actions: [...(g?.actions ?? [])], scope: g?.scope ?? 'all' };
  }
  grants.custom = { actions: [...((p.custom ?? p['*'])?.actions ?? [])], scope: (p.custom ?? p['*'])?.scope ?? 'all' };
  return grants;
}

export function Roles({ data, reload }) {
  const { api, modules, can, apply } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState(data.roles[1]?.key ?? data.roles[0].key);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const editableModules = useMemo(() => modules.filter((m) => m.page !== false && !['dashboard'].includes(m.key)), [modules]);
  const role = data.roles.find((r) => r.key === selected) ?? data.roles[0];
  const locked = role.key === 'owner' || !can('team', 'edit');

  useEffect(() => {
    setDraft({ name: role.name, description: role.description ?? '', permissions: explicitGrants(role, editableModules), hiddenFields: structuredClone(role.hiddenFields ?? {}) });
  }, [role, editableModules]);

  if (!draft) return null;

  const toggle = (key, action) => setDraft((d) => {
    const grant = d.permissions[key];
    const has = grant.actions.includes(action);
    let actions = has ? grant.actions.filter((a) => a !== action) : [...grant.actions, action];
    if (!has && action !== 'view') actions = [...new Set([...actions, 'view'])];
    if (has && action === 'view') actions = [];
    return { ...d, permissions: { ...d.permissions, [key]: { ...grant, actions } } };
  });
  const toggleHidden = (moduleKey, fieldKey) => setDraft((d) => {
    const list = d.hiddenFields[moduleKey] ?? [];
    return { ...d, hiddenFields: { ...d.hiddenFields, [moduleKey]: list.includes(fieldKey) ? list.filter((k) => k !== fieldKey) : [...list, fieldKey] } };
  });

  async function save() {
    setBusy(true);
    try {
      const next = await api.put(`/team/roles/${role.key}`, draft);
      apply(next);
      reload();
      toast(`${draft.name} saved`);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  async function create() {
    try {
      const result = await api.post('/team/roles', { name: `${role.name} (copy)`, description: role.description ?? '', permissions: explicitGrants(role, editableModules), hiddenFields: role.hiddenFields ?? {} });
      apply(result);
      await reload();
      setSelected(result.role.key);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function remove() {
    if (!(await confirm({ title: `Delete the ${role.name} role?`, message: 'Only roles nobody holds can be deleted.', confirmLabel: 'Delete role', danger: true }))) return;
    try { apply(await api.del(`/team/roles/${role.key}`)); await reload(); setSelected('admin'); } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <div className="side-layout" style={{ '--side-w': '240px' }}>
      <div className="card side-nav">
        {data.roles.map((r) => (
          <button key={r.key} type="button" className={`menu-item${r.key === selected ? ' active' : ''}`} onClick={() => setSelected(r.key)}>
            {r.key === 'owner' ? <Lock /> : <ShieldCheck />}<span className="grow">{r.name}</span><span className="tiny subtle">{data.members.filter((m) => m.role === r.key).length}</span>
          </button>
        ))}
        {can('team', 'edit') ? <><div className="menu-sep" /><button type="button" className="menu-item" onClick={create}><Plus />Copy “{role.name}” as new role</button></> : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="grow stack-sm">
            <input className="input" style={{ fontWeight: 620, maxWidth: 320 }} value={draft.name} disabled={locked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Role name" />
            <input className="input input-sm" value={draft.description} disabled={locked} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What this role is for" aria-label="Description" />
          </div>
          {!locked ? <div className="row">{!role.system ? <Button variant="danger-ghost" icon={<Trash2 />} onClick={remove}>Delete</Button> : null}<Button onClick={save} loading={busy}>Save role</Button></div> : null}
        </div>
        {role.key === 'owner' ? <div className="card-body"><Alert kind="info">Owners can always do everything. This role cannot be narrowed, so a workspace can never lock itself out.</Alert></div> : null}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Module</th>{Object.values(ACTION_LABELS).map((a) => <th key={a} className="center">{a}</th>)}<th>Records</th><th>Hidden fields</th></tr></thead>
            <tbody>
              {editableModules.map((m) => {
                const grant = draft.permissions[m.key];
                const hiddenCount = (draft.hiddenFields[m.key] ?? []).length;
                return (
                  <tr key={m.key}>
                    <td><span className="row"><Icon name={m.icon} size={15} /><span className="cell-title">{m.label}</span>{m.locked ? <span className="pro-chip">PRO</span> : null}</span></td>
                    {Object.keys(ACTION_LABELS).map((action) => (
                      <td key={action} className="center" title={action === 'approve' ? APPROVE_HINTS[m.key] : undefined}>
                        {m.actions?.includes(action)
                          ? <input type="checkbox" checked={grant.actions.includes(action)} disabled={locked} onChange={() => toggle(m.key, action)} aria-label={`${m.label}: ${action}`} style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }} />
                          : <span className="subtle">·</span>}
                      </td>
                    ))}
                    <td>
                      {['view', 'edit'].some((a) => m.actions?.includes(a)) && m.key !== 'settings' && m.key !== 'team' ? (
                        <select className="input input-sm" style={{ width: 110 }} value={grant.scope} disabled={locked || !grant.actions.length} onChange={(e) => setDraft({ ...draft, permissions: { ...draft.permissions, [m.key]: { ...grant, scope: e.target.value } } })} aria-label="Scope">
                          <option value="all">All</option><option value="own">Own only</option>
                        </select>
                      ) : null}
                    </td>
                    <td>
                      {m.fields?.length ? (
                        <Menu align="right" trigger={({ toggle: open }) => <Button variant="ghost" size="sm" onClick={open} disabled={locked && !hiddenCount}>{hiddenCount ? `${hiddenCount} hidden` : 'None'}</Button>}>
                          <div className="menu-label">Hide from this role</div>
                          {m.fields.filter((f) => !f.locked).map((f) => (
                            <label key={f.key} className="menu-item" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={(draft.hiddenFields[m.key] ?? []).includes(f.key)} disabled={locked} onChange={() => toggleHidden(m.key, f.key)} />{f.label}
                            </label>
                          ))}
                        </Menu>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Team({ module }) {
  const { api, slug } = useWorkspace();
  const [tab, setTab] = useState('members');
  const { data, reload, loading } = useResource(`team:${slug}`, () => api.get('/team'));
  return (
    <>
      <PageHeader title={module?.label ?? 'Team & roles'} description="Who can use this workspace, and what each role is allowed to do." />
      <div style={{ marginBottom: '1rem' }}><Tabs tabs={[{ value: 'members', label: 'Members', count: data?.members.length }, { value: 'roles', label: 'Roles & permissions' }]} value={tab} onChange={setTab} /></div>
      {loading && !data ? <div className="card"><SkeletonRows /></div> : null}
      {data ? (tab === 'members' ? <Members data={data} reload={reload} /> : <Roles data={data} reload={reload} />) : null}
    </>
  );
}
