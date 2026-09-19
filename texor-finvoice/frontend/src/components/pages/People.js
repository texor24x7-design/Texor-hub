'use client';

/**
 * Everyone who works here, in one place.
 *
 * Staff records and workspace members used to be two sidebar modules over the
 * same humans, joined only by a matching email and saying so nowhere. This is
 * one list — employment on one side, access on the other — with the tabs that
 * act on them: the day's attendance, the month's register, and what each role
 * may do.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MailPlus, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, UserPlus, UserX } from 'lucide-react';
import { Alert, Avatar, Badge, Button, ButtonLink, Dialog, EmptyState, Field, Menu, MenuItem, PageHeader, SkeletonRows, Tabs, useConfirm, useToast } from '@/components/ui';
import { invalidate, useResource } from '@/lib/data';
import { fileUrl } from '@/lib/api';
import { date } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace';
import { Roles } from './Team';
import { Attendance, Register } from './Attendance';

function InviteDialog({ open, onClose, person, roles, onDone }) {
  const { api } = useWorkspace();
  const toast = useToast();
  const [role, setRole] = useState('staff');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const address = person ? person.email : email;

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/team/invites', { email: address, role });
      toast('Invitation ready — copy the link and send it to them');
      onDone();
      onClose();
    } catch (error) {
      setErrors({ ...error.fieldErrors, _: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={person ? `Give ${person.name} a login` : 'Invite somebody'}
      description="They sign in with their Texor account. Their attendance and work stay as they are."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} loading={busy}>Send invitation</Button></>}>
      <div className="stack">
        {errors._ ? <Alert kind="error">{errors._}</Alert> : null}
        <Field label="Email" required error={errors.email}>
          <input className="input" type="email" value={address} readOnly={Boolean(person?.email)} onChange={(e) => setEmail(e.target.value)} autoFocus={!person?.email} />
        </Field>
        <Field label="Role" hint={roles.find((r) => r.key === role)?.description}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.filter((r) => r.key !== 'owner').map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

function PeopleList({ module }) {
  const { api, slug, href, can, member: me } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, reload } = useResource(`people:${slug}`, () => api.get('/people'));
    // A null key is how `useResource` is switched off — a role without team
  // access must not fetch it.
  const { data: team, reload: reloadTeam } = useResource(can('team', 'view') ? `team:${slug}` : null, () => api.get('/team'));
  const [inviting, setInviting] = useState(null);

  const refresh = () => { invalidate(`people:${slug}`); invalidate(`team:${slug}`); reload(); reloadTeam?.(); };
  const canAccess = can('team', 'edit');

  async function setStatus(person, status, label) {
    try {
      await api.patch(`/team/members/${person.memberId}`, { status });
      toast(label);
      refresh();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function removeAccess(person) {
    if (!(await confirm({ title: `Remove ${person.name}'s access?`, message: 'They lose access to this workspace immediately. Their employment record and past work stay.', confirmLabel: 'Remove access', danger: true }))) return;
    try {
      await api.del(`/team/members/${person.memberId}`);
      toast('Access removed');
      refresh();
    } catch (error) { toast(error.message, 'error'); }
  }

  if (loading && !data) return <div className="card"><SkeletonRows /></div>;
  const people = data?.people ?? [];

  return (
    <>
      <div className="card">
        <div className="toolbar">
          <span className="small muted">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
          <div className="grow" />
          {canAccess ? <Button size="sm" variant="secondary" icon={<MailPlus />} onClick={() => setInviting({ name: '', email: '' })}>Invite</Button> : null}
          {can('staff', 'create') ? <ButtonLink size="sm" href={href('/staff/new')} icon={<Plus />}>Add someone</ButtonLink> : null}
        </div>

        {!people.length ? (
          <EmptyState icon={<UserPlus />} title="Nobody here yet">Add the people who work here — they do not need a Texor account.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Does</th><th>Shift</th><th>Can sign in</th><th /></tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const isMe = p.memberId && p.memberId === me._id;
                  const isOwner = p.access?.role === 'owner';
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="row">
                          <Avatar name={p.name} src={p.photo ? fileUrl(p.photo) : undefined} />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="strong ellipsis" style={{ display: 'block' }}>
                              {p.staffId ? <Link href={href(`/staff/${p.staffId}`)}>{p.name}</Link> : p.name}
                              {isMe ? <span className="muted"> (you)</span> : null}
                            </span>
                            {p.email ? <span className="sub ellipsis" style={{ display: 'block' }}>{p.email}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td>{p.designation || <span className="subtle">—</span>}</td>
                      <td className="nowrap">{p.shiftStart ? `${p.shiftStart}–${p.shiftEnd || '…'}` : <span className="subtle">—</span>}</td>
                      <td>
                        {p.access
                          ? <span className="row" style={{ gap: '0.4rem' }}>
                            <Badge tone={isOwner ? 'brand' : 'neutral'} plain>{p.access.roleName}</Badge>
                            {p.access.status !== 'active' ? <Badge tone={p.access.status === 'invited' ? 'amber' : 'neutral'}>{p.access.status}</Badge> : null}
                          </span>
                          : <span className="subtle">No login</span>}
                      </td>
                      <td className="right">
                        <Menu align="right" trigger={({ toggle }) => <Button variant="ghost" size="sm" icon={<MoreHorizontal />} aria-label={`Actions for ${p.name}`} onClick={toggle} />}>
                          {p.staffId && can('staff', 'edit') ? <MenuItem icon={<Pencil />} href={href(`/staff/${p.staffId}/edit`)}>Edit details</MenuItem> : null}
                          {!p.staffId && can('staff', 'create') ? <MenuItem icon={<UserPlus />} href={href('/staff/new')}>Add employment details</MenuItem> : null}
                          {!p.access && p.email && canAccess ? <MenuItem icon={<MailPlus />} onClick={() => setInviting(p)}>Invite to Finvoice</MenuItem> : null}
                          {!p.access && !p.email && can('staff', 'edit') ? <MenuItem icon={<MailPlus />} href={href(`/staff/${p.staffId}/edit`)}>Add an email to invite them</MenuItem> : null}
                          {p.access && canAccess && !isOwner && !isMe && p.access.status === 'active' ? <MenuItem icon={<UserX />} onClick={() => setStatus(p, 'disabled', 'Access suspended')}>Suspend access</MenuItem> : null}
                          {p.access && canAccess && !isOwner && !isMe && p.access.status === 'disabled' && p.access.hasAccount ? <MenuItem icon={<ShieldCheck />} onClick={() => setStatus(p, 'active', 'Access restored')}>Restore access</MenuItem> : null}
                          {p.access && canAccess && !isOwner && !isMe ? <MenuItem icon={<Trash2 />} danger onClick={() => removeAccess(p)}>Remove access</MenuItem> : null}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {team?.inviteLink ? (
        <p className="small muted" style={{ marginTop: '0.75rem' }}>
          Invited people sign in at <span className="mono">{team.inviteLink}</span> with the email you invited.
        </p>
      ) : null}

      <InviteDialog open={Boolean(inviting)} person={inviting?.email ? inviting : null} roles={team?.roles ?? []} onClose={() => setInviting(null)} onDone={refresh} />
    </>
  );
}

export function People({ module }) {
  const { api, slug, can } = useWorkspace();
  const [tab, setTab] = useState('people');
  const { data: team, reload: reloadTeam } = useResource(can('team', 'view') ? `team:${slug}` : null, () => api.get('/team'));

  const tabs = useMemo(() => [
    { value: 'people', label: 'People' },
    { value: 'today', label: 'Today' },
    { value: 'register', label: 'Register' },
    ...(can('team', 'view') ? [{ value: 'roles', label: 'Roles' }] : []),
  ], [can]);

  return (
    <>
      <PageHeader
        title={module.label}
        description="Everyone who works here — what they do, when they were in, and what they may use."
      />
      <div style={{ marginBottom: '1rem' }}><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'people' ? <PeopleList module={module} /> : null}
      {tab === 'today' ? <div className="card"><Attendance /></div> : null}
      {tab === 'register' ? <div className="card"><Register /></div> : null}
      {tab === 'roles' && team ? <Roles data={team} reload={reloadTeam} /> : null}
    </>
  );
}
