'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Alert } from '@/components/ui';
import { CalendarIcon, NotesIcon, PlusIcon, VideoPlusIcon } from '@/components/icons';
import { HeroDoodle } from '@/components/HeroDoodle';
import { meetings as meetingApi, notes as notesApi } from '@/lib/api';
import { accentFor } from '@/lib/accent';
import { greetingFor, startedAgo, whenParts } from '@/lib/duration';

/**
 * The first screen after signing in.
 *
 * Everything here does something. An earlier version carried a setup checklist
 * with a step that could never be completed, a day column that read "No
 * meetings" eight times, a tip card and three links of which two went to the
 * same wrong page. They filled the screen and told nobody anything, which is
 * the opposite of what a dashboard is for.
 */
export default function HomePage() {
  return <AppShell>{(user) => <Home user={user} />}</AppShell>;
}

function Home({ user }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(null);

  const load = useCallback(async () => {
    try {
      /**
       * Two questions, not one.
       *
       * "What is happening right now" is about rooms this person has been
       * inside that somebody is in at this moment — the server answers it from
       * the live socket list, so a room everybody walked out of is simply not
       * in the reply. "What is coming up" is about the calendar. They used to
       * be the same fetch sorted two ways, which is why an abandoned meeting
       * sat at the top of the page advertising itself as live.
       */
      const [live, upcoming] = await Promise.all([
        meetingApi.list('joined'),
        meetingApi.list('upcoming'),
      ]);

      setList({ live: live.meetings, upcoming: upcoming.meetings });
    } catch (loadError) {
      setError(loadError.message);
      setList({ live: [], upcoming: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    notesApi.list({ scope: 'mine' })
      .then(({ notes: mine }) => { if (!cancelled) setNotes(mine.slice(0, 5)); })
      // Notes failing is not a reason to break the dashboard; the panel simply
      // shows nothing.
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, []);

  async function startInstant() {
    setBusy(true);
    setError(null);
    try {
      // A display name comes from an identity provider and may not be a string.
      const first = (typeof user.displayName === 'string' ? user.displayName : '').split(' ')[0];
      const { meeting } = await meetingApi.create({
        title: first ? `${first}'s meeting` : 'New meeting',
        access: 'texor',
      });
      router.push(`/meetings/${meeting.code}`);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  }

  const first = (typeof user.displayName === 'string' ? user.displayName : '').split(' ')[0];

  const liveRows = (list?.live ?? []).slice(0, 4);
  const liveCodes = new Set(liveRows.map((meeting) => meeting.code));

  // A room that is open right now belongs under "Live", not in the schedule
  // underneath it as well.
  const soonRows = (list?.upcoming ?? [])
    .filter((meeting) => !liveCodes.has(meeting.code))
    .sort((left, right) => {
      const at = (m) => new Date(m.nextOccurrence?.start ?? m.startedAt ?? 0).getTime();
      return at(left) - at(right);
    })
    .slice(0, 6);

  const quick = [
    {
      key: 'start',
      tint: 'blue',
      icon: <VideoPlusIcon />,
      title: 'Start a meeting',
      blurb: 'Instant, no setup',
      onClick: startInstant,
    },
    {
      key: 'join',
      tint: 'green',
      icon: <PlusIcon />,
      title: 'Join a meeting',
      blurb: 'With a code or link',
      onClick: () => document.getElementById('joinbar-code')?.focus(),
    },
    {
      key: 'schedule',
      tint: 'orange',
      icon: <CalendarIcon />,
      title: 'Schedule',
      blurb: 'Plan one for later',
      onClick: () => router.push('/meetings?new=1'),
    },
    {
      key: 'notes',
      tint: 'yellow',
      icon: <NotesIcon />,
      title: 'Notes',
      blurb: 'What was written down',
      onClick: () => router.push('/notes'),
    },
  ];

  return (
    <div className="home">
      <Alert kind="error">{error}</Alert>

      <section className="hero">
        <div className="hero__copy">
          <p className="hero__greet">
            {greetingFor()}{first ? `, ${first}` : ''}
          </p>
          <h1 className="hero__title">Ready to bring people together?</h1>
          <p className="hero__sub">
            Start an instant meeting, schedule one for later, or join with a code.
          </p>

          <div className="hero__actions">
            <button type="button" className="btn btn--primary" onClick={startInstant} disabled={busy}>
              <VideoPlusIcon />
              {busy ? 'Starting…' : 'Start a meeting'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => router.push('/meetings?new=1')}>
              <CalendarIcon />
              Schedule
            </button>
          </div>
        </div>

        <figure className="hero__figure">
          <HeroDoodle className="hero__doodle" />
        </figure>
      </section>

      <section className="quick">
        {quick.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`quick__card quick__card--${item.tint}`}
            onClick={item.onClick}
            disabled={item.key === 'start' && busy}
          >
            <span className="quick__icon">{item.icon}</span>
            <span className="quick__text">
              <strong>{item.title}</strong>
              <span>{item.blurb}</span>
            </span>
          </button>
        ))}
      </section>

      <div className="home__cols">
      <div className="stack">
        {/*
          * Rooms with somebody in them, and only those.
          *
          * The section is absent rather than empty when nothing is open — a
          * heading over a blank panel saying "nobody is meeting" is chrome
          * reporting the ordinary case as if it were news.
          */}
        {liveRows.length > 0 ? (
          <section className="agenda">
            <header className="agenda__head">
              <h2>Live now</h2>
              <a className="agenda__more" href="/meetings">View all</a>
            </header>
            <div className="agenda__grid">
              {liveRows.map((meeting) => (
                <Card
                  key={meeting.code}
                  meeting={meeting}
                  onOpen={() => router.push(`/meetings/${meeting.code}`)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="agenda">
          <header className="agenda__head">
            <h2>Scheduled</h2>
            {soonRows.length > 0 ? <a className="agenda__more" href="/meetings">View all</a> : null}
          </header>

          {list === null ? (
            <p className="agenda__quiet">Loading…</p>
          ) : soonRows.length === 0 ? (
            <div className="agenda__empty">
              <p>Nothing scheduled.</p>
              <button type="button" className="btn btn--secondary" onClick={() => router.push('/meetings?new=1')}>
                Schedule a meeting
              </button>
            </div>
          ) : (
            <div className="agenda__grid">
              {soonRows.map((meeting) => (
                <Card
                  key={meeting.code}
                  meeting={meeting}
                  onOpen={() => router.push(`/meetings/${meeting.code}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Recent notes={notes} onOpen={(id) => router.push(`/notes/${id}`)} />
      </div>
    </div>
  );
}

/**
 * One meeting, as a card.
 *
 * Rows were the wrong shape: a row is as wide as the page and a meeting has
 * about three hundred pixels to say, so whatever stretched left a hole.
 *
 * What makes it read as alive rather than as a record is mostly three things —
 * a colour it keeps, faces of the people actually in it, and a motif in the
 * corner that belongs to its state. None of it is invented: the colour comes
 * from the code, the faces come from the roster.
 */
function Card({ meeting, onOpen }) {
  /**
   * Live means somebody is in there, not that a column says so.
   *
   * `presentCount` is counted from open sockets, so a room everybody left
   * stops claiming to be live the moment the last person goes rather than up
   * to ninety seconds later — or never, which is what happened when nothing
   * swept the list.
   */
  const isLive = (meeting.presentCount ?? 0) > 0;
  const accent = accentFor(meeting.code, { live: isLive });
  const when = whenParts(meeting.nextOccurrence?.start ?? meeting.startedAt);

  // Who is in it now, or who is expected. Both are real; neither is invented.
  const faces = (isLive ? meeting.participants : meeting.invitees) ?? [];
  const shown = faces.slice(0, 3);
  const more = faces.length - shown.length;

  return (
    <button
      type="button"
      className={`mcard mcard--${accent}`}
      onClick={onOpen}
      aria-label={`${isLive ? 'Join' : 'Open'} ${meeting.title}`}
    >
      <CardMotif live={isLive} />

      <span className="mcard__when">
        {isLive ? (
          <>
            <span className="mcard__dot" aria-hidden="true" />
            Live
            <span className="mcard__sep" aria-hidden="true">·</span>
            {startedAgo(meeting.startedAt)}
          </>
        ) : (
          <>
            {when.primary === '—' ? null : (
              <>
                {when.primary}
                <span className="mcard__sep" aria-hidden="true">·</span>
              </>
            )}
            {when.secondary}
          </>
        )}
      </span>

      <strong className="mcard__title">{meeting.title}</strong>

      <span className="mcard__sub">
        {meeting.viewer?.isHost ? 'You host' : meeting.host?.name}
        <span className="mcard__sep" aria-hidden="true">·</span>
        <code className="mcard__code">{meeting.code}</code>
      </span>

      <span className="mcard__foot">
        {shown.length > 0 ? (
          <span className="faces">
            {shown.map((person) => (
              <span className="faces__one" key={person.texorId ?? person.email} title={person.name}>
                {person.picture
                  ? <img src={person.picture} alt="" />
                  : (person.name ?? '?').trim().charAt(0).toUpperCase()}
              </span>
            ))}
            {more > 0 ? <span className="faces__more">+{more}</span> : null}
          </span>
        ) : <span className="mcard__who">{meeting.viewer?.isHost ? 'Only you so far' : ''}</span>}

        <span className="mcard__go" aria-hidden="true">{isLive ? 'Join' : 'Open'}</span>
      </span>
    </button>
  );
}

/**
 * The mark in the corner.
 *
 * Two of them, and which one appears says something: waves for a meeting that
 * is broadcasting, a clock for one that is waiting. Drawn at low opacity in
 * the card's own colour, so it reads as texture rather than as a control.
 */
function CardMotif({ live }) {
  return (
    <svg className="mcard__motif" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {live ? (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="32" cy="32" r="5" fill="currentColor" stroke="none" />
          <path d="M20 21a17 17 0 0 0 0 22M44 21a17 17 0 0 1 0 22" />
          <path d="M12 13a28 28 0 0 0 0 38M52 13a28 28 0 0 1 0 38" opacity="0.5" />
        </g>
      ) : (
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="32" cy="34" r="20" />
          <path d="M32 22v12l8 5" />
          <path d="M22 9l-8 6M42 9l8 6" opacity="0.6" />
        </g>
      )}
    </svg>
  );
}

/**
 * What was written down lately.
 *
 * Here because the meetings panel had two cards and most of a page to itself,
 * and because these two are the same question asked twice — what is happening,
 * and what came of it. Real notes, from the notes the signed-in person wrote.
 */
function Recent({ notes, onOpen }) {
  return (
    <section className="recent">
      <header className="recent__head">
        <h2>Recent notes</h2>
        {notes?.length ? <a className="agenda__more" href="/notes">View all</a> : null}
      </header>

      {notes === null ? (
        <p className="recent__quiet">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="recent__quiet">
          Notes you take in a meeting show up here.
        </p>
      ) : (
        <ul className="recent__list">
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" className="recent__item" onClick={() => onOpen(note.id)}>
                <strong>{note.title || 'Untitled note'}</strong>
                <span>{note.meetingTitle || 'No meeting'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
