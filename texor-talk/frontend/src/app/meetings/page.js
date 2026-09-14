'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, Loading, formatTimestamp } from '@/components/ui';
import { meetings as meetingApi } from '@/lib/api';

/** Start one, join one, or look at what is coming. */
export default function MeetingsPage() {
  return <AppShell>{(user) => <MeetingsHome user={user} />}</AppShell>;
}

function MeetingsHome({ user }) {
  const router = useRouter();
  const [scope, setScope] = useState('upcoming');
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const load = useCallback(async () => {
    try {
      const { meetings } = await meetingApi.list(scope);
      setList(meetings);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
      setList([]);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  async function startInstant() {
    setBusy(true);
    setError(null);
    try {
      const { meeting } = await meetingApi.create({
        title: `${user.displayName.split(' ')[0]}'s meeting`,
        access: 'texor',
      });
      router.push(`/meetings/${meeting.code}`);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--loose">
      <section className="meeting-hero">
        <div className="panel">
          <div className="panel__header">
            <h1>Meetings</h1>
            <p>Start a call now, or put one in the calendar.</p>
          </div>

          <Alert kind="error">{error}</Alert>

          <div className="row row--wrap" style={{ gap: '0.6rem', marginTop: '0.5rem' }}>
            <Button onClick={startInstant} loading={busy}>New meeting</Button>
            <Button variant="secondary" onClick={() => setScheduling((open) => !open)}>
              {scheduling ? 'Cancel' : 'Schedule for later'}
            </Button>
          </div>

          {scheduling ? (
            <ScheduleForm
              onCancel={() => setScheduling(false)}
              onCreated={(meeting) => router.push(`/meetings/${meeting.code}/details`)}
            />
          ) : null}
        </div>

        <JoinByCode onJoin={(code) => router.push(`/meetings/${code}`)} />
      </section>

      <section className="panel">
        <div className="row row--between row--wrap panel__header">
          <h2>Your meetings</h2>
          <nav className="row" style={{ gap: '0.25rem' }}>
            {['upcoming', 'live', 'past'].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={scope === value ? 'secondary' : 'ghost'}
                onClick={() => setScope(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </nav>
        </div>

        {list === null ? (
          <Loading label="Loading meetings" />
        ) : list.length === 0 ? (
          <p className="meta">
            {scope === 'past' ? 'No meetings behind you yet.' : 'Nothing scheduled.'}
          </p>
        ) : (
          <div className="list">
            {list.map((meeting) => (
              <MeetingRow key={meeting.code} meeting={meeting} router={router} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MeetingRow({ meeting, router }) {
  const when = meeting.nextOccurrence?.start ?? meeting.startedAt ?? meeting.endedAt;
  const repeats = meeting.recurrence?.freq && meeting.recurrence.freq !== 'none';

  return (
    <div className="list__item">
      <span
        className={`status-dot ${meeting.status === 'live' ? 'status-dot--live' : ''}`}
        aria-hidden="true"
      />

      <div className="grow">
        <strong>{meeting.title}</strong>
        <div className="meta">
          {meeting.status === 'live' ? 'Happening now' : when ? formatTimestamp(when) : 'Any time'}
          {repeats ? ` · repeats ${meeting.recurrence.freq}` : ''}
          {meeting.status === 'cancelled' ? ' · cancelled' : ''}
          {' · '}
          {meeting.viewer.isHost ? 'You host' : `Hosted by ${meeting.host.name}`}
        </div>
      </div>

      <span className="code">{meeting.code}</span>

      {meeting.status === 'ended' || meeting.status === 'cancelled' ? (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/meetings/${meeting.code}/details`)}>
          Details
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => router.push(`/meetings/${meeting.code}/details`)}>
            Details
          </Button>
          <Button size="sm" onClick={() => router.push(`/meetings/${meeting.code}`)}>
            {meeting.status === 'live' ? 'Join' : 'Open'}
          </Button>
        </>
      )}
    </div>
  );
}

function JoinByCode({ onJoin }) {
  const [code, setCode] = useState('');

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Join a meeting</h2>
        <p>Enter the code from the invitation.</p>
      </div>

      <form
        className="join-box"
        onSubmit={(event) => {
          event.preventDefault();
          const cleaned = code.trim().toLowerCase();
          if (cleaned) onJoin(cleaned);
        }}
      >
        <input
          className="input"
          placeholder="abc-defg-hij"
          aria-label="Meeting code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!code.trim()}>Join</Button>
      </form>
    </div>
  );
}

/** Everything a scheduled meeting needs, and nothing it does not. */
function ScheduleForm({ onCreated, onCancel }) {
  const [form, setForm] = useState(() => {
    // Default to the next half hour, which is what someone scheduling "now-ish"
    // almost always means.
    const start = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
    const end = new Date(start.getTime() + 30 * 60000);
    return {
      title: '',
      agenda: '',
      start: toLocalInput(start),
      end: toLocalInput(end),
      access: 'texor',
      freq: 'none',
      invitees: '',
    };
  });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const { meeting } = await meetingApi.create({
        title: form.title,
        agenda: form.agenda,
        scheduledStart: new Date(form.start).toISOString(),
        scheduledEnd: new Date(form.end).toISOString(),
        // Carried so the invite can say which zone the host meant, even though
        // the times themselves travel as UTC.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        access: form.access,
        recurrence: { freq: form.freq, interval: 1, count: null, until: null },
        invitees: parseInvitees(form.invitees),
      });
      onCreated(meeting);
    } catch (createError) {
      setError(createError.message);
      setFieldErrors(createError.fieldErrors ?? {});
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: '1.25rem' }}>
      <Alert kind="error">{error}</Alert>

      <Field label="What is it" htmlFor="title" error={fieldErrors.title}>
        <input id="title" className="input" required autoFocus placeholder="Weekly review"
          value={form.title} onChange={set('title')} />
      </Field>

      <Field label="Agenda" hint="Shown to everyone before they join, and in the calendar invite." htmlFor="agenda">
        <textarea id="agenda" className="input" rows={2} value={form.agenda} onChange={set('agenda')} />
      </Field>

      <div className="row row--wrap" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
        <Field label="Starts" htmlFor="start" error={fieldErrors.scheduledStart}>
          <input id="start" type="datetime-local" className="input" required
            value={form.start} onChange={set('start')} />
        </Field>
        <Field label="Ends" htmlFor="end" error={fieldErrors.scheduledEnd}>
          <input id="end" type="datetime-local" className="input" required
            value={form.end} onChange={set('end')} />
        </Field>
        <Field label="Repeats" htmlFor="freq">
          <select id="freq" className="input" value={form.freq} onChange={set('freq')}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </Field>
      </div>

      <Field label="Who can join" htmlFor="access">
        <select id="access" className="input" value={form.access} onChange={set('access')}>
          <option value="texor">Anyone with a Texor Account</option>
          <option value="invited">Only people I invite</option>
          <option value="anyone">Anyone with the code, including guests</option>
        </select>
      </Field>

      <Field
        label="Invite people"
        hint="Email addresses, separated by commas. They can add it to their calendar from the invitation."
        htmlFor="invitees"
      >
        <input id="invitees" className="input" placeholder="mo@texor.app, sam@partner.com"
          value={form.invitees} onChange={set('invitees')} />
      </Field>

      <div className="row" style={{ gap: '0.6rem' }}>
        <Button type="submit" loading={busy}>Schedule</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** `datetime-local` wants local wall time with no zone, not an ISO string. */
function toLocalInput(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const parseInvitees = (value) =>
  value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, name: '', role: 'participant' }));
