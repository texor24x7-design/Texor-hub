'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, Loading, formatTimestamp } from '@/components/ui';
import { CalendarIcon, ChevronIcon, VideoPlusIcon } from '@/components/icons';
import { meetings as meetingApi } from '@/lib/api';
import { usePoll } from '@/lib/use-poll';
import { LiveCard } from '@/components/LiveCard';
import { StartMeetingDialog, defaultMeetingTitle } from '@/components/StartMeetingDialog';

/** Start one, join one, or look at what is coming. */
export default function MeetingsPage() {
  return <AppShell>{(user) => <MeetingsHome user={user} />}</AppShell>;
}

function MeetingsHome({ user }) {
  const router = useRouter();
  const [scope, setScope] = useState('upcoming');
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  // Whether anything has ever arrived, so a failed *refresh* is not
  // mistaken for a failed *load*.
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const { meetings } = await meetingApi.list(scope);
      loaded.current = true;
      setList(meetings);
      setError(null);
    } catch (loadError) {
      /**
       * A refresh that fails leaves what is on screen alone.
       *
       * This runs every few seconds now, and the first version of it blanked
       * the page and put up an error on any failure — so one flaky request, a
       * sleeping laptop or a moment of no signal would replace a perfectly good
       * agenda with "network error". The reader is only told when there was
       * never anything to show them.
       */
      if (loaded.current) return;
      setError(loadError.message);
      setList([]);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // `?new=1` is what the top bar and the home page point at, and until now
  // nothing read it — both landed on this page with the form still shut.
  // Read from `location` rather than `useSearchParams`, which would need a
  // Suspense boundary around the whole page to build.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) setScheduling(true);
  }, []);

  // Who is in a meeting changes while this page is open. Ten seconds is short
  // enough that a room filling up or emptying is noticed, and long enough that
  // an idle agenda is not a stream of requests.
  usePoll(load, 10_000);

  // Occupied rooms. `presentCount` comes from the live socket list, so an
  // abandoned meeting is not one of them however its status reads.
  const live = (list ?? []).filter((m) => (m.presentCount ?? 0) > 0);

  /**
   * Which day the list is showing.
   *
   * Meetings are a calendar-shaped thing, and a week strip is how people expect
   * to move through one — far quicker than reading a flat list and working out
   * which entries are today's.
   */
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const week = weekAround(day);

  const forDay = (list ?? []).filter((meeting) => {
    const when = meeting.nextOccurrence?.start ?? meeting.startedAt ?? meeting.endedAt;
    // An instant meeting has no scheduled time and belongs to today.
    if (!when) return isSameDay(day, new Date());
    return isSameDay(new Date(when), day);
  });

  return (
    <div className="dash">
      <Alert kind="error">{error}</Alert>

      {starting ? (
        <StartMeetingDialog
          defaultTitle={defaultMeetingTitle(user)}
          onClose={() => setStarting(false)}
          onStarted={(meeting) => router.push(`/meetings/${meeting.code}`)}
        />
      ) : null}

      <header className="daybar">
        <div className="daybar__title">
          <CalendarIcon />
          <h1>{longDay(day)}</h1>
        </div>

        <div className="daybar__week">
          <button
            type="button" className="daybar__arrow" aria-label="Previous week"
            onClick={() => setDay(addDays(day, -7))}
          >
            <ChevronIcon style={{ transform: 'rotate(90deg)' }} />
          </button>

          {week.map((date) => {
            const selected = isSameDay(date, day);
            return (
              <button
                key={date.toISOString()}
                type="button"
                className={`daybar__day ${selected ? 'daybar__day--on' : ''}`}
                aria-current={selected ? 'date' : undefined}
                onClick={() => setDay(date)}
              >
                <span className="daybar__dow">{shortDow(date)}</span>
                <span className="daybar__num">{date.getDate()}</span>
              </button>
            );
          })}

          <button
            type="button" className="daybar__arrow" aria-label="Next week"
            onClick={() => setDay(addDays(day, 7))}
          >
            <ChevronIcon style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </div>
      </header>

      {live.length > 0 ? (
        <section className="dash__live">
          <h2>
            <span className="status-dot status-dot--live" aria-hidden="true" />
            Happening now
          </h2>
          <div className="dash__cards">
            {live.map((meeting) => (
              <LiveCard
                key={meeting.code}
                meeting={meeting}
                onOpen={() => router.push(`/meetings/${meeting.code}`)}
                onEnded={load}
                onError={setError}
              />
            ))}
          </div>
        </section>
      ) : null}

      {scheduling ? (
        <section className="panel">
          <div className="panel__header"><h2>Schedule a meeting</h2></div>
          <ScheduleForm
            onCancel={() => setScheduling(false)}
            onCreated={(meeting) => router.push(`/meetings/${meeting.code}/details`)}
          />
        </section>
      ) : null}

      {list === null ? (
        <Loading label="Loading meetings" />
      ) : forDay.length === 0 ? (
        <div className="empty-day">
          <EmptyDayArt />
          <h2>{isSameDay(day, new Date()) ? 'No meetings scheduled for today' : 'Nothing on this day'}</h2>
          <p>Start one now, or put it in the calendar.</p>
          <div className="empty-day__actions">
            <button type="button" className="shell__new" onClick={() => setStarting(true)}>
              <VideoPlusIcon />
              <span>New meeting</span>
            </button>
            <Button variant="secondary" onClick={() => setScheduling((open) => !open)}>
              {scheduling ? 'Cancel' : 'Schedule'}
            </Button>
          </div>
        </div>
      ) : (
        <section className="panel">
          <div className="row row--between row--wrap panel__header">
            <h2>{isSameDay(day, new Date()) ? 'Today' : longDay(day)}</h2>
            <div className="row" style={{ gap: '0.5rem' }}>
              <Button variant="secondary" size="sm" onClick={() => setScheduling((open) => !open)}>
                {scheduling ? 'Cancel' : 'Schedule'}
              </Button>
              <button type="button" className="shell__new" onClick={() => setStarting(true)}>
                <VideoPlusIcon />
                <span>New</span>
              </button>
            </div>
          </div>

          <div className="list">
            {forDay.map((meeting) => (
              <MeetingRow key={meeting.code} meeting={meeting} router={router} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── dates ────────────────────────────────────────────────────────────────────

const startOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const addDays = (date, days) => startOfDay(new Date(date.getTime() + days * 86400000));
const isSameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const shortDow = (date) => date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
const longDay = (date) =>
  date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Monday-first week containing `day`. */
function weekAround(day) {
  const monday = addDays(day, -((day.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** A small piece of warmth on a page that would otherwise be an empty box. */
const EmptyDayArt = () => (
  <svg viewBox="0 0 220 140" width="220" height="140" aria-hidden="true" className="empty-day__art">
    <ellipse cx="110" cy="128" rx="74" ry="5" fill="currentColor" opacity=".10" />
    <rect x="118" y="58" width="62" height="62" rx="8" fill="currentColor" opacity=".13" />
    <rect x="126" y="70" width="46" height="38" rx="5" fill="currentColor" opacity=".18" />
    <path d="M92 66h34v54H92z" fill="currentColor" opacity=".08" />
    <path d="M62 78c0-9 7-16 16-16h6v46a12 12 0 0 1-12 12h0a10 10 0 0 1-10-10V78Z" fill="currentColor" opacity=".16" />
    <path d="M84 70h10a8 8 0 0 1 0 16h-10" fill="none" stroke="currentColor" strokeWidth="3" opacity=".22" />
    <path d="M74 40c0-6 6-6 6-12s-6-6-6-12" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" opacity=".2" />
    <path d="M88 44c0-5 5-5 5-10s-5-5-5-10" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" opacity=".14" />
    <circle cx="168" cy="40" r="9" fill="currentColor" opacity=".25" />
  </svg>
);

function MeetingRow({ meeting, router }) {
  const when = meeting.nextOccurrence?.start ?? meeting.startedAt ?? meeting.endedAt;
  const repeats = meeting.recurrence?.freq && meeting.recurrence.freq !== 'none';

  return (
    <div className="list__item">
      <span
        className={`status-dot ${(meeting.presentCount ?? 0) > 0 ? 'status-dot--live' : ''}`}
        aria-hidden="true"
      />

      <div className="grow">
        <strong>{meeting.title}</strong>
        <div className="meta">
          {(meeting.presentCount ?? 0) > 0
            ? 'Happening now'
            : when ? formatTimestamp(when) : 'Any time'}
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
            {(meeting.presentCount ?? 0) > 0 ? 'Join' : 'Open'}
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
          id="join-code"
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
      lobby: '',
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
        // Left out when the host did not choose, so the organisation's own
        // default still applies.
        ...(form.lobby ? { lobby: form.lobby } : {}),
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

      <Field label="Waiting room" hint="You and your co-hosts never wait." htmlFor="lobby">
        <select id="lobby" className="input" value={form.lobby} onChange={set('lobby')}>
          <option value="">My organisation&rsquo;s default</option>
          <option value="off">Off — everyone walks in</option>
          <option value="external">Guests from outside knock</option>
          <option value="everyone">Everyone knocks</option>
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
