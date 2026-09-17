'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, Loading, formatTimestamp } from '@/components/ui';
import { admin as adminApi } from '@/lib/api';

/**
 * The admin console: policy, live meetings, and the audit log.
 *
 * Reachable only by an admin — but that is enforced by the API, which refuses
 * every one of these calls to anyone else. This page just renders the refusal
 * honestly if it happens.
 */
export default function AdminPage() {
  return <AppShell>{(user) => <AdminConsole user={user} />}</AppShell>;
}

const TABS = [
  ['policy', 'Policy'],
  ['meetings', 'Meetings'],
  ['audit', 'Audit log'],
];

function AdminConsole() {
  const [tab, setTab] = useState('policy');

  return (
    <div className="stack stack--loose">
      <div>
        <h1>Administration</h1>
        <p className="meta" style={{ marginTop: '0.3rem' }}>
          Organisation-wide settings for Texor Talk meetings.
        </p>
        <nav className="nav">
          {TABS.map(([value, label]) => (
            <a
              key={value}
              href={`#${value}`}
              aria-current={tab === value ? 'page' : undefined}
              onClick={(event) => { event.preventDefault(); setTab(value); }}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {tab === 'policy' ? <PolicyPanel /> : null}
      {tab === 'meetings' ? <MeetingsPanel /> : null}
      {tab === 'audit' ? <AuditPanel /> : null}
    </div>
  );
}

// ── Policy ───────────────────────────────────────────────────────────────────

function PolicyPanel() {
  const [policy, setPolicy] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi
      .policy()
      .then((data) => {
        setPolicy(data.policy);
        setEnvironment(data.environment);
        setDraft(data.policy);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  if (error && !policy) return <div className="panel"><Alert kind="error">{error}</Alert></div>;
  if (!draft) return <Loading label="Loading policy" />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const toggle = (key, label, hint) => (
    <label className="switch">
      <input type="checkbox" checked={Boolean(draft[key])} onChange={(e) => set(key, e.target.checked)} />
      <span>{label}<small>{hint}</small></span>
    </label>
  );

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const { policy: saved, changed } = await adminApi.savePolicy({
        whoCanCreateMeetings: draft.whoCanCreateMeetings,
        creatorAllowlist: draft.creatorAllowlist,
        allowExternalGuests: draft.allowExternalGuests,
        forceLobbyForExternal: draft.forceLobbyForExternal,
        lobbyDefault: draft.lobbyDefault,
        maxDurationMinutes: Number(draft.maxDurationMinutes),
        maxParticipants: Number(draft.maxParticipants),
        defaultMuteOnEntry: draft.defaultMuteOnEntry,
        defaultVideoOffOnEntry: draft.defaultVideoOffOnEntry,
        screenShareDefault: draft.screenShareDefault,
        maxQuality: draft.maxQuality,
        allowCaptions: draft.allowCaptions,
        storeTranscripts: draft.storeTranscripts,
        transcriptRetentionDays: Number(draft.transcriptRetentionDays),
        captionsDefault: draft.captionsDefault,
      });
      setPolicy(saved);
      setDraft(saved);
      setNotice(changed.length ? `Saved — ${changed.join(', ')}.` : 'Nothing to change.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <h2>Meeting policy</h2>
          <p>
            Enforced by the server as each meeting is created and joined. Existing meetings keep the
            limits they were created with.
          </p>
        </div>

        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>

        <div className="policy-grid">
          <Field label="Who can start meetings" htmlFor="whoCanCreate">
            <select
              id="whoCanCreate" className="input" value={draft.whoCanCreateMeetings}
              onChange={(event) => set('whoCanCreateMeetings', event.target.value)}
            >
              <option value="anyone">Anyone with a Texor Account</option>
              <option value="allowlist">Only approved people</option>
            </select>
          </Field>

          <Field label="Waiting room default" hint="Hosts can tighten this, never loosen it below the rule beside it." htmlFor="lobbyDefault">
            <select
              id="lobbyDefault" className="input" value={draft.lobbyDefault}
              onChange={(event) => set('lobbyDefault', event.target.value)}
            >
              <option value="off">Off</option>
              <option value="external">Outside guests knock</option>
              <option value="everyone">Everyone knocks</option>
            </select>
          </Field>

          <Field
            label="Highest video quality"
            hint="The ceiling hosts choose within. Bandwidth is the main running cost of a meeting, and it grows with headcount multiplied by bitrate."
            htmlFor="maxQuality"
          >
            <select
              id="maxQuality" className="input" value={draft.maxQuality ?? 'high'}
              onChange={(event) => set('maxQuality', event.target.value)}
            >
              <option value="saver">Data saver — lowest bandwidth</option>
              <option value="standard">Standard — good for most meetings</option>
              <option value="high">High — sharpest, most bandwidth</option>
            </select>
          </Field>

          <Field label="Screen sharing default" htmlFor="screenShareDefault">
            <select
              id="screenShareDefault" className="input" value={draft.screenShareDefault}
              onChange={(event) => set('screenShareDefault', event.target.value)}
            >
              <option value="everyone">Anyone can share</option>
              <option value="hosts">Hosts only</option>
            </select>
          </Field>

          <Field label="Maximum length" hint="Minutes. 0 means no limit — the call is ended when it is reached." htmlFor="maxDuration">
            <input
              id="maxDuration" type="number" min="0" max="1440" className="input"
              value={draft.maxDurationMinutes}
              onChange={(event) => set('maxDurationMinutes', event.target.value)}
            />
          </Field>

          <Field label="Maximum participants" hint="0 means no limit." htmlFor="maxParticipants">
            <input
              id="maxParticipants" type="number" min="0" max="1000" className="input"
              value={draft.maxParticipants}
              onChange={(event) => set('maxParticipants', event.target.value)}
            />
          </Field>
        </div>

        {draft.whoCanCreateMeetings === 'allowlist' ? (
          <Field
            label="Approved hosts"
            hint="Texor account ids, one per line. Admins can always start a meeting."
            htmlFor="allowlist"
          >
            <textarea
              id="allowlist" className="input" rows={3}
              value={draft.creatorAllowlist.join('\n')}
              onChange={(event) =>
                set('creatorAllowlist', event.target.value.split(/\s+/).map((v) => v.trim()).filter(Boolean))
              }
            />
          </Field>
        ) : null}

        <div className="stack stack--tight" style={{ marginTop: '1.25rem' }}>
          {toggle('allowExternalGuests', 'Allow guests from outside the organisation', 'Off means only Texor Accounts on your domains can join anything.')}
          {toggle('forceLobbyForExternal', 'Always hold outside guests in the lobby', 'Overrides a host who turned the waiting room off.')}
          {toggle('defaultMuteOnEntry', 'New meetings mute people on entry', null)}
          {toggle('defaultVideoOffOnEntry', 'New meetings start with cameras off', null)}
        </div>

        {/*
          * Captions are two decisions, not one.
          *
          * Whether people may be transcribed at all, and whether that
          * transcription is *kept*, have different answers in most
          * organisations — "help people follow the conversation" is a much
          * smaller ask than "keep a durable, attributed record of what everyone
          * said". Collapsing them into one switch would force the larger answer
          * on anybody who wanted the smaller one.
          */}
        <h3 className="panel__subhead">Captions and transcripts</h3>

        <div className="stack stack--tight">
          {toggle('allowCaptions', 'Allow live captions in meetings', 'Speech is transcribed by this server. No audio leaves your deployment.')}
          {draft.allowCaptions ? (
            toggle('storeTranscripts', 'Keep a transcript of captioned meetings', 'Off means captions appear live and nothing is written down.')
          ) : null}
        </div>

        {draft.allowCaptions ? (
          <div className="row row--wrap" style={{ marginTop: '1rem', alignItems: 'flex-start' }}>
            <Field
              label="New meetings start with captions"
              hint="Hosts can always turn them on themselves, and everyone in the call is told."
              htmlFor="captionsDefault"
            >
              <select
                id="captionsDefault" className="input" value={draft.captionsDefault ?? 'off'}
                onChange={(event) => set('captionsDefault', event.target.value)}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </Field>

            {draft.storeTranscripts ? (
              <Field
                label="Delete transcripts after"
                hint="Days. 0 keeps them indefinitely. Changing this applies to transcripts already stored, not just future ones."
                htmlFor="transcriptRetentionDays"
              >
                <input
                  id="transcriptRetentionDays" className="input" type="number" min={0} max={3650}
                  value={draft.transcriptRetentionDays ?? 0}
                  onChange={(event) => set('transcriptRetentionDays', event.target.value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="row" style={{ gap: '0.6rem', marginTop: '1.25rem' }}>
          <Button onClick={save} loading={busy} disabled={!dirty}>
            {dirty ? 'Save policy' : 'Saved'}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(policy)}>Discard</Button>
          ) : null}
        </div>

        <p className="meta" style={{ marginTop: '1rem' }}>
          Last changed {policy.updatedAt ? formatTimestamp(policy.updatedAt) : 'never'}
          {policy.updatedBy ? ` by ${policy.updatedBy}` : ''}.
        </p>
      </section>

      {environment ? <DeploymentPanel environment={environment} /> : null}
    </>
  );
}

/**
 * The settings that come from deployment config rather than this console.
 *
 * The media server is part of this process, so there is no third party to
 * report the health of — only our own workers and the one setting that decides
 * whether media actually reaches anyone: the announced address.
 */
function DeploymentPanel({ environment }) {
  const media = environment.media ?? {};
  const workers = media.workers ?? [];
  const healthy = workers.filter((worker) => !worker.closed).length;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Deployment</h2>
        <p>Set in the API&apos;s environment. Not editable here, by design.</p>
      </div>

      {media.isLocalOnly ? (
        <Alert kind="error">
          Media is announced at <strong>{media.announcedAddress}</strong>, which only this machine can
          reach. Calls between two devices will connect and then carry no audio or video. Set
          MEDIA_ANNOUNCED_ADDRESS to an address participants can actually reach.
        </Alert>
      ) : (
        <Alert kind="success">
          Media is announced at {media.announcedAddress}, on ports {media.rtcPortRange}. The SFU runs
          inside this server — no external conferencing service is involved.
        </Alert>
      )}

      <div className="list" style={{ marginTop: '1rem' }}>
        <div className="list__item">
          <div className="grow">
            <strong>Media workers</strong>
            <div className="meta">One per CPU core. Each meeting is assigned to one of them.</div>
          </div>
          <span className="meta">
            {healthy} of {workers.length} running
          </span>
        </div>
        <div className="list__item">
          <div className="grow">
            <strong>RTC ports</strong>
            <div className="meta">Must be open in the firewall, UDP and TCP</div>
          </div>
          <span className="code">{media.rtcPortRange}</span>
        </div>
        <div className="list__item">
          <div className="grow">
            <strong>Video ceiling</strong>
            <div className="meta">Per participant, before simulcast layers are dropped</div>
          </div>
          <span className="meta">{Math.round((media.maxBitrate ?? 0) / 1000)} kbps</span>
        </div>
        <div className="list__item">
          <div className="grow">
            <strong>Admins by email</strong>
            <div className="meta">ADMIN_EMAILS — cannot be edited away from in here</div>
          </div>
          <span className="meta">{environment.adminEmails.join(', ') || 'none'}</span>
        </div>
        <div className="list__item">
          <div className="grow">
            <strong>Internal email domains</strong>
            <div className="meta">ORG_EMAIL_DOMAINS — everyone else is an external guest</div>
          </div>
          <span className="meta">
            {environment.orgEmailDomains.join(', ') || 'none set — nobody counts as external'}
          </span>
        </div>
        <div className="list__item">
          <div className="grow">
            <strong>Early joining</strong>
            <div className="meta">How far ahead of the scheduled time people may join</div>
          </div>
          <span className="meta">{environment.joinEarlyMinutes} minutes</span>
        </div>
      </div>

      {workers.length > 0 ? (
        <div className="audit__scroll" style={{ marginTop: '1rem' }}>
          <table className="audit">
            <thead>
              <tr>
                <th scope="col">Worker PID</th>
                <th scope="col">State</th>
                <th scope="col">CPU (user / system)</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.pid}>
                  <td>{worker.pid}</td>
                  <td>{worker.closed ? 'closed' : 'running'}</td>
                  <td>
                    {worker.usage
                      ? `${Math.round(worker.usage.ru_utime / 1000)}ms / ${Math.round(worker.usage.ru_stime / 1000)}ms`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ── Meetings ─────────────────────────────────────────────────────────────────

function MeetingsPanel() {
  const [status, setStatus] = useState('live');
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    adminApi
      .meetings(status)
      .then((data) => setMeetings(data.meetings))
      .catch((loadError) => setError(loadError.message));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="panel">
      <div className="row row--between row--wrap panel__header">
        <div>
          <h2>Meetings across the organisation</h2>
          <p>Every meeting, not only your own.</p>
        </div>
        <div className="row" style={{ gap: '0.25rem' }}>
          {['live', 'scheduled', 'ended', 'all'].map((value) => (
            <Button
              key={value} size="sm"
              variant={status === value ? 'secondary' : 'ghost'}
              onClick={() => { setMeetings(null); setStatus(value); }}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <Alert kind="error">{error}</Alert>

      {meetings === null ? (
        <Loading label="Loading meetings" />
      ) : meetings.length === 0 ? (
        <p className="meta">Nothing {status === 'all' ? 'yet' : status}.</p>
      ) : (
        <div className="list">
          {meetings.map((meeting) => (
            <div className="list__item" key={meeting.code}>
              <span
                className={`status-dot ${meeting.status === 'live' ? 'status-dot--live' : ''}`}
                aria-hidden="true"
              />
              <div className="grow">
                <strong>{meeting.title}</strong>
                <div className="meta">
                  {meeting.host.name} ({meeting.host.email}) ·{' '}
                  {meeting.status === 'live'
                    ? `${meeting.participantCount} in the call now`
                    : `${meeting.attendedCount} attended`}
                  {meeting.recurrence !== 'none' ? ` · repeats ${meeting.recurrence}` : ''}
                </div>
              </div>
              <span className="meta">
                {meeting.startedAt
                  ? formatTimestamp(meeting.startedAt)
                  : meeting.scheduledStart
                    ? formatTimestamp(meeting.scheduledStart)
                    : '—'}
              </span>
              <span className="code">{meeting.code}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────

const ACTION_GROUPS = [
  ['', 'Everything'],
  ['meeting.created', 'Meetings created'],
  ['meeting.joined', 'Joins'],
  ['lobby.knocked', 'Lobby requests'],
  ['lobby.admitted', 'Lobby admissions'],
  ['participant.removed', 'Removals'],
  ['role.granted', 'Role grants'],
  ['policy.updated', 'Policy changes'],
];

function AuditPanel() {
  const [events, setEvents] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [filters, setFilters] = useState({ action: '', meetingCode: '' });
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (append = false) => {
    setBusy(true);
    try {
      const data = await adminApi.audit({
        ...filters,
        before: append ? nextBefore : undefined,
        limit: 50,
      });
      setEvents((current) => (append && current ? [...current, ...data.events] : data.events));
      setNextBefore(data.nextBefore);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, [filters, nextBefore]);

  // Deliberately keyed on the filters only: adding `load` would re-run this
  // every time the cursor moved and undo the paging it had just done.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .audit({ ...filters, limit: 50 })
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setNextBefore(data.nextBefore);
      })
      .catch((loadError) => !cancelled && setError(loadError.message));
    return () => { cancelled = true; };
  }, [filters]);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Audit log</h2>
        <p>
          Append-only. Every row is hashed over its own contents and numbered without gaps, so an
          edited or deleted row can be detected.
        </p>
      </div>

      <Alert kind="error">{error}</Alert>

      <div className="row row--wrap" style={{ gap: '0.6rem', marginBottom: '1.25rem' }}>
        <select
          className="input" style={{ width: 'auto' }} aria-label="Filter by action"
          value={filters.action}
          onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
        >
          {ACTION_GROUPS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <input
          className="input" style={{ width: 'auto', fontFamily: 'var(--mono)' }}
          placeholder="meeting code" aria-label="Filter by meeting code"
          value={filters.meetingCode}
          onChange={(event) => setFilters((current) => ({ ...current, meetingCode: event.target.value.trim() }))}
        />

        <span className="grow" />

        <Button
          variant="secondary" size="sm"
          onClick={async () => {
            setVerification(null);
            try {
              const { verification: result } = await adminApi.verifyAudit();
              setVerification(result);
            } catch (verifyError) {
              setError(verifyError.message);
            }
          }}
        >
          Verify integrity
        </Button>
      </div>

      {verification ? (
        <Alert kind={verification.ok ? 'success' : 'error'}>
          {verification.ok
            ? `All ${verification.events} entries verified — sequence ${verification.firstSeq} to ${verification.lastSeq}, head ${verification.head?.slice(0, 16)}…`
            : `Integrity check failed. ${
                verification.tamperedSeqs.length
                  ? `Altered entries: ${verification.tamperedSeqs.join(', ')}. `
                  : ''
              }${
                verification.missingSeqs.length
                  ? `Missing entries: ${verification.missingSeqs.join(', ')}.`
                  : ''
              }`}
        </Alert>
      ) : null}

      {events === null ? (
        <Loading label="Loading the log" />
      ) : events.length === 0 ? (
        <p className="meta">Nothing recorded for this filter.</p>
      ) : (
        <>
          <div className="audit__scroll">
            <table className="audit">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Who</th>
                  <th scope="col">Meeting</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.seq}>
                    <td>{event.seq}</td>
                    <td>{formatTimestamp(event.at)}</td>
                    <td className="audit__action">{event.action}</td>
                    <td>
                      {event.actor.name || '—'}
                      {event.actor.email ? <div className="meta">{event.actor.email}</div> : null}
                    </td>
                    <td className="audit__action">{event.meetingCode ?? '—'}</td>
                    <td className="audit__meta">
                      {event.target ? `→ ${event.target.name || event.target.texorId} ` : ''}
                      {describe(event.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nextBefore ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => load(true)} style={{ marginTop: '1rem' }}>
              Load older
            </Button>
          ) : (
            <p className="meta" style={{ marginTop: '1rem' }}>That is the whole log.</p>
          )}
        </>
      )}
    </section>
  );
}

/** Metadata is free-form, so render it readably rather than as raw JSON. */
function describe(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';

  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== '' && value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' · ');
}
