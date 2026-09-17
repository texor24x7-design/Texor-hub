'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Field, Loading, formatTimestamp } from '@/components/ui';
import { meetings as meetingApi, notes as notesApi } from '@/lib/api';
import { LockIcon, PlusIcon, ShareIcon, TranscriptIcon, TrashIcon } from '@/components/icons';
import { activeFor, durationBetween, formatDuration } from '@/lib/duration';

/**
 * Everything about a meeting that is not the call itself: when it is, who is
 * invited, how they get in, and what the calendar should say.
 *
 * Host-only controls are rendered from `viewer.isHost`, which the server sends.
 * That is a convenience for the person looking at the page — the server refuses
 * the write regardless of what this component chose to draw.
 */
export default function MeetingDetailsPage({ params }) {
  const { code } = use(params);
  return <AppShell>{(user) => <MeetingDetails code={code} user={user} />}</AppShell>;
}

function MeetingDetails({ code }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const { meeting: found } = await meetingApi.get(code);
      setMeeting(found);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const run = (work) => async (...args) => {
    setError(null);
    setNotice(null);
    try {
      const result = await work(...args);
      if (result?.meeting) setMeeting(result.meeting);
      return result;
    } catch (actionError) {
      setError(actionError.message);
      return null;
    }
  };

  if (!meeting && !error) return <Loading label="Loading meeting" />;
  if (!meeting) {
    return (
      <div className="panel">
        <Alert kind="error">{error}</Alert>
        <Button variant="secondary" onClick={() => router.push('/meetings')} style={{ marginTop: '1rem' }}>
          Back to meetings
        </Button>
      </div>
    );
  }

  const isHost = meeting.viewer.isHost;
  const over = meeting.status === 'ended' || meeting.status === 'cancelled';

  return (
    <div className="stack stack--loose">
      <section className="panel">
        <div className="row row--between row--wrap panel__header">
          <div>
            <span className="badge">{meeting.status}</span>
            <h1 style={{ marginTop: '0.5rem' }}>{meeting.title}</h1>
            <p className="meta" style={{ marginTop: '0.3rem' }}>
              {meeting.nextOccurrence
                ? formatTimestamp(meeting.nextOccurrence.start)
                : 'Starts whenever someone joins'}
              {meeting.recurrence?.freq !== 'none' ? ` · repeats ${meeting.recurrence.freq}` : ''}
              {' · '}hosted by {meeting.host.name}
              {/*
                * Duration, in the tense the meeting is actually in. A finished
                * meeting's length is the thing people come back here to find.
                */}
              {/*
                * Occupied time in both tenses. `endedAt - startedAt` counted
                * every minute the room sat empty, so a meeting people were in
                * for ten minutes either side of lunch was reported as two
                * hours long — and that figure is the thing people come back
                * here to find.
                */}
              {meeting.endedAt && meeting.activeMs
                ? ` · ran for ${formatDuration(meeting.activeMs)}`
                : ''}
              {!meeting.endedAt && activeFor(meeting)
                ? ` · ${activeFor(meeting)}`
                : ''}
            </p>
          </div>

          {!over ? <Button onClick={() => router.push(`/meetings/${code}`)}>Open the meeting</Button> : null}
        </div>

        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>

        {meeting.agenda ? (
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{meeting.agenda}</p>
        ) : null}

        <div className="row row--wrap" style={{ gap: '0.6rem' }}>
          <span className="code">{meeting.code}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(meeting.joinUrl);
              setNotice('Joining link copied.');
            }}
          >
            Copy link
          </Button>
          {/* A download, so it goes through the browser rather than through fetch. */}
          <a className="btn btn--secondary btn--sm" href={meetingApi.inviteUrl(code)}>
            Add to calendar
          </a>
        </div>

        {meeting.viewer.response ? (
          <div className="row row--wrap" style={{ gap: '0.6rem', marginTop: '1.25rem' }}>
            <span className="meta">You are invited — </span>
            {['accepted', 'tentative', 'declined'].map((response) => (
              <Button
                key={response}
                size="sm"
                variant={meeting.viewer.response === response ? 'secondary' : 'ghost'}
                onClick={run(() => meetingApi.rsvp(code, response))}
              >
                {{ accepted: 'Going', tentative: 'Maybe', declined: 'Not going' }[response]}
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      {isHost && !over ? <HostSettings meeting={meeting} onSave={run((body) => meetingApi.update(code, body))} /> : null}

      <InviteeList
        meeting={meeting}
        isHost={isHost && !over}
        onInvite={run((invitees) => meetingApi.invite(code, invitees))}
        onUninvite={run((email) => meetingApi.uninvite(code, email))}
      />

      {meeting.attendance?.length ? <Attendance meeting={meeting} /> : null}

      <MeetingTranscript code={code} isOwner={meeting.viewer?.isOwner} />

      <MeetingNotes code={code} />

      {isHost && !over ? (
        <section className="panel">
          <div className="panel__header">
            <h2>Cancel this meeting</h2>
            <p>
              Everyone loses access to the code
              {meeting.recurrence?.freq !== 'none' ? ', and the whole repeating series stops' : ''}.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={async () => {
              if (!window.confirm(`Cancel "${meeting.title}"? This cannot be undone.`)) return;
              await run(() => meetingApi.cancel(code))();
            }}
          >
            Cancel meeting
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function HostSettings({ meeting, onSave }) {
  const [draft, setDraft] = useState({
    access: meeting.access,
    lobby: meeting.lobby,
    quality: meeting.quality ?? 'standard',
    ...meeting.settings,
  });
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify({
    access: meeting.access, lobby: meeting.lobby, quality: meeting.quality ?? 'standard',
    ...meeting.settings,
  });

  async function save() {
    setBusy(true);
    const { access, lobby, quality, ...settings } = draft;
    await onSave({ access, lobby, quality, settings });
    setBusy(false);
  }

  const toggle = (key, label, hint) => (
    <label className="switch">
      <input
        type="checkbox"
        checked={Boolean(draft[key])}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))}
      />
      <span>{label}<small>{hint}</small></span>
    </label>
  );

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>How people get in</h2>
        <p>Applies from the next time someone joins.</p>
      </div>

      <div className="policy-grid">
        <Field label="Who can join" htmlFor="access">
          <select
            id="access" className="input" value={draft.access}
            onChange={(event) => setDraft((current) => ({ ...current, access: event.target.value }))}
          >
            <option value="texor">Anyone with a Texor Account</option>
            <option value="invited">Only people I invite</option>
            <option value="anyone">Anyone with the code</option>
          </select>
        </Field>

        <Field
          label="Waiting room"
          hint="Hosts and co-hosts never wait."
          htmlFor="lobby"
        >
          <select
            id="lobby" className="input" value={draft.lobby}
            onChange={(event) => setDraft((current) => ({ ...current, lobby: event.target.value }))}
          >
            <option value="off">Off — everyone walks in</option>
            <option value="external">Guests from outside knock</option>
            <option value="everyone">Everyone knocks</option>
          </select>
        </Field>

        <Field
          label="Video quality"
          hint={
            meeting.qualityCeiling && meeting.qualityCeiling !== 'high'
              ? `Your plan allows up to "${meeting.qualityCeiling}".`
              : 'Higher quality uses more bandwidth for everyone in the meeting.'
          }
          htmlFor="quality"
        >
          <select
            id="quality" className="input" value={draft.quality}
            onChange={(event) => setDraft((current) => ({ ...current, quality: event.target.value }))}
          >
            {(meeting.qualityOptions ?? []).map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.name} — {tier.blurb}</option>
            ))}
          </select>
        </Field>

        <Field label="Screen sharing" htmlFor="screenShare">
          <select
            id="screenShare" className="input" value={draft.screenShare}
            onChange={(event) => setDraft((current) => ({ ...current, screenShare: event.target.value }))}
          >
            <option value="everyone">Anyone can share</option>
            <option value="hosts">Hosts only</option>
          </select>
        </Field>
      </div>

      <div className="stack stack--tight" style={{ marginTop: '1.25rem' }}>
        {toggle('muteOnEntry', 'Mute people as they arrive', 'Hosts join unmuted.')}
        {toggle('videoOffOnEntry', 'Camera off as they arrive', null)}
        {toggle('allowChat', 'Allow in-call chat', null)}
        {toggle('allowExternalGuests', 'Allow guests from outside the organisation', 'Your org policy can still forbid this.')}
      </div>

      <Button onClick={save} loading={busy} disabled={!dirty} style={{ marginTop: '1.25rem' }}>
        {dirty ? 'Save changes' : 'Saved'}
      </Button>
    </section>
  );
}

function InviteeList({ meeting, isHost, onInvite, onUninvite }) {
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);

  const labels = { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', 'needs-action': 'No reply' };

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Invited ({meeting.invitees.length})</h2>
        <p>Invitees can add the meeting to their calendar and are never held in the lobby.</p>
      </div>

      {meeting.invitees.length === 0 ? (
        <p className="meta">Nobody invited yet — anyone with the code can still join.</p>
      ) : (
        <div className="list">
          {meeting.invitees.map((invitee) => (
            <div className="list__item" key={invitee.email ?? invitee.texorId ?? invitee.name}>
              <div className="grow">
                <strong>{invitee.name || invitee.email || 'Invited'}</strong>
                <div className="meta">
                  {invitee.email ? `${invitee.email} · ` : ''}
                  {labels[invitee.response]}
                  {invitee.role === 'cohost' ? ' · co-host' : ''}
                </div>
              </div>
              {isHost && invitee.email ? (
                <Button variant="ghost" size="sm" onClick={() => onUninvite(invitee.email)}>Remove</Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {isHost ? (
        <form
          className="join-box"
          style={{ marginTop: '1.25rem' }}
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = emails
              .split(/[,\s]+/)
              .map((entry) => entry.trim().toLowerCase())
              .filter(Boolean)
              .map((email) => ({ email, name: '', role: 'participant' }));
            if (parsed.length === 0) return;

            setBusy(true);
            const result = await onInvite(parsed);
            if (result) setEmails('');
            setBusy(false);
          }}
        >
          <input
            className="input"
            style={{ fontFamily: 'var(--font)', letterSpacing: 'normal' }}
            placeholder="mo@texor.app, sam@partner.com"
            aria-label="Email addresses to invite"
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
          />
          <Button type="submit" variant="secondary" loading={busy} disabled={!emails.trim()}>Invite</Button>
        </form>
      ) : null}
    </section>
  );
}

/** Who actually turned up. Host-only, and only once somebody has. */
/**
 * The notes from this meeting.
 *
 * Both lists in one panel rather than two: after a meeting you are looking for
 * "what was written down", and whether you or a colleague wrote it is a detail
 * of the row, not a reason to look somewhere else.
 */
/**
 * What was said, read back after the meeting.
 *
 * The panel in the call draws the captions that arrived on the socket, because
 * while a meeting is running that is the only copy the browser has. This draws
 * the *stored* transcript, which is authoritative — it includes anything a
 * browser missed while it was reconnecting, and it is still here next week.
 *
 * Renders nothing at all when there is none, which is most meetings. An empty
 * "Transcript" panel on every meeting that was never captioned would be a
 * permanent piece of furniture advertising a feature nobody used.
 */
function MeetingTranscript({ code, isOwner }) {
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    meetingApi.transcript(code)
      .then(({ transcript: found }) => { if (!cancelled) setTranscript(found); })
      // A meeting somebody cannot read the transcript of looks the same as one
      // that has none, which is the intended behaviour rather than an error.
      .catch(() => { if (!cancelled) setTranscript(null); });
    return () => { cancelled = true; };
  }, [code]);

  if (!transcript) return null;

  const turns = transcript.text.split('\n').filter(Boolean);

  return (
    <section className="panel">
      <div className="row row--between row--wrap panel__header">
        <div>
          <h2>Transcript</h2>
          <p>
            {transcript.segments.length} utterance{transcript.segments.length === 1 ? '' : 's'}
            {transcript.languages?.length > 1 ? ` in ${transcript.languages.join(', ')}` : ''}
            {transcript.expiresAt
              ? ` · deleted ${formatTimestamp(transcript.expiresAt)}`
              : ''}
          </p>
        </div>

        <div className="row" style={{ gap: '0.5rem' }}>
          {/* A link rather than a fetch: the server renders the file, so this
              downloads the canonical transcript rather than a second rendering
              of it made in the browser. */}
          <a className="btn btn--secondary btn--sm" href={meetingApi.transcriptUrl(code)} download>
            <TranscriptIcon />
            Download
          </a>

          {isOwner ? (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={async () => {
                if (!window.confirm('Delete this transcript? The record of what was said goes with it.')) return;
                setBusy(true);
                setError(null);
                try {
                  await meetingApi.deleteTranscript(code);
                  setTranscript(null);
                } catch (deleteError) {
                  setError(deleteError.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <TrashIcon />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <Alert kind="error">{error}</Alert>

      {transcript.truncated ? (
        <Alert kind="info">
          This meeting ran past the length a single transcript can hold, so the
          last part of it was not recorded.
        </Alert>
      ) : null}

      {/*
        * Rendered from the server's own text, split back into lines, so the
        * page and the downloaded file cannot say different things.
        */}
      <div className="transcript">
        {turns.map((line, index) => {
          const split = line.indexOf(': ');
          const who = split === -1 ? '' : line.slice(0, split);
          const said = split === -1 ? line : line.slice(split + 2);

          return (
            <p className="transcript__turn" key={index}>
              {who ? <span className="transcript__who">{who}</span> : null}
              {said}
            </p>
          );
        })}
      </div>
    </section>
  );
}

function MeetingNotes({ code }) {
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    notesApi.list({ scope: 'all', meetingCode: code })
      .then(({ notes: found }) => { if (!cancelled) setRows(found); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [code]);

  if (rows === null) return null;

  return (
    <section className="panel">
      <div className="row row--between row--wrap panel__header">
        <div>
          <h2>Notes</h2>
          <p>Yours are private unless you share them with the people who were here.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const { note } = await notesApi.create({ meetingCode: code, blocks: [] });
              router.push(`/notes/${note.id}`);
            } catch (createError) {
              setError(createError.message);
              setBusy(false);
            }
          }}
        >
          <PlusIcon /> New note
        </Button>
      </div>

      <Alert kind="error">{error}</Alert>

      {rows.length === 0 ? (
        <p className="meta">Nothing written down yet.</p>
      ) : (
        <div className="notes__grid">
          {rows.map((note) => (
            <button
              key={note.id}
              type="button"
              className="notes__card"
              onClick={() => router.push(`/notes/${note.id}`)}
            >
              <div className="notes__card-top">
                <h3>{note.title || 'Untitled note'}</h3>
                <span className="notes__card-vis">
                  {note.visibility === 'meeting' ? <ShareIcon /> : <LockIcon />}
                </span>
              </div>
              <p className="notes__card-preview">{note.preview || 'Empty'}</p>
              <div className="notes__card-foot">
                {note.isMine ? <span className="badge">You</span> : <span className="badge">{note.owner.name}</span>}
                {note.mentionsMe ? <span className="badge badge--accent">Mentions you</span> : null}
                <span className="notes__stat notes__stat--right">{note.stats.words} words</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Attendance({ meeting }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Attendance</h2>
        <p>Recorded by the server as people joined and left.</p>
      </div>

      <div className="audit__scroll">
        <table className="audit">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Joined</th>
              <th scope="col">Left</th>
              <th scope="col">Time in call</th>
              <th scope="col">Rejoins</th>
            </tr>
          </thead>
          <tbody>
            {meeting.attendance.map((entry) => (
              <tr key={entry.texorId}>
                <td style={{ fontFamily: 'var(--font)' }}>
                  {entry.name}
                  <div className="meta">{entry.email}</div>
                </td>
                <td>{entry.role}</td>
                <td>{formatTimestamp(entry.firstJoinedAt)}</td>
                <td>{entry.leftAt ? formatTimestamp(entry.leftAt) : 'still in the call'}</td>
                {/*
                  * Wall-clock from first join to leaving, so somebody who
                  * dropped and came back reads as one continuous stretch —
                  * which is what "was this person in the meeting" means.
                  */}
                <td>{durationBetween(entry.firstJoinedAt, entry.leftAt)}</td>
                <td>{entry.joins > 1 ? entry.joins - 1 : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
