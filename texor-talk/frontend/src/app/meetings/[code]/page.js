'use client';

import { Fragment, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { VideoTile } from '@/components/VideoTile';
import { Alert, Avatar, Button, Loading } from '@/components/ui';
import {
  CameraIcon, CameraOffIcon, ChatIcon, CheckIcon, CloseIcon, CopyIcon, HangUpIcon,
  InfoIcon, MicIcon, MicOffIcon, PeopleIcon, PresentIcon, PresentOffIcon,
  ReactionIcon, RemovePersonIcon, SendIcon,
} from '@/components/icons';

/** Must match the server's allowlist in media/signalling.js. */
const REACTIONS = ['👍', '👎', '❤️', '🎉', '👏', '😂', '😮', '😢', '🤔', '✋'];
import { meetings as meetingApi } from '@/lib/api';
import { MeetingRoom } from '@/lib/room';

/**
 * One meeting, in four states.
 *
 *   greenroom  what this meeting is, and a button to ask to join
 *   waiting    knocked, and a host has not decided yet
 *   live       the call
 *   over       ended, cancelled, removed, or refused
 *
 * The server decides which applies. This page never proceeds because the
 * previous screen let it — the media socket re-runs the same admission check.
 */

const KNOCK_POLL_MS = 3_000;

export default function MeetingPage({ params }) {
  const { code } = use(params);
  return <AppShell>{(user) => <MeetingScreen code={code} user={user} />}</AppShell>;
}

function MeetingScreen({ code, user }) {
  const router = useRouter();

  const [meeting, setMeeting] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [grant, setGrant] = useState(null);
  const [knockId, setKnockId] = useState(null);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [notice, setNotice] = useState(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    meetingApi
      .get(code)
      .then(({ meeting: found }) => {
        setMeeting(found);
        setPhase(found.status === 'cancelled' ? 'over' : 'greenroom');
      })
      .catch((loadError) => {
        setError(loadError.message);
        setErrorCode(loadError.code ?? null);
        setPhase('over');
      });
  }, [code]);

  const join = useCallback(async () => {
    setJoining(true);
    setError(null);

    try {
      const result = await meetingApi.join(code);
      setMeeting(result.meeting);

      if (result.status === 'waiting') {
        setKnockId(result.knockId);
        setPhase('waiting');
      } else {
        setGrant(result.media);
        setPhase('live');
      }
    } catch (joinError) {
      if (joinError.code === 'too_early' && joinError.details?.opensAt) {
        setError(
          `This meeting opens at ${new Date(joinError.details.opensAt).toLocaleTimeString(undefined, {
            hour: '2-digit', minute: '2-digit',
          })}.`,
        );
      } else {
        setError(joinError.message);
      }
    } finally {
      setJoining(false);
    }
  }, [code]);

  // Waiting in the lobby.
  useEffect(() => {
    if (phase !== 'waiting' || !knockId) return undefined;

    const timer = setInterval(async () => {
      try {
        const result = await meetingApi.knockStatus(code, knockId);

        if (result.status === 'admitted') {
          setGrant(result.media);
          setMeeting(result.meeting);
          setPhase('live');
        } else if (result.status === 'denied') {
          setError('The host did not let you in.');
          setPhase('over');
        } else if (result.status === 'expired') {
          setError('Nobody answered your request to join.');
          setPhase('greenroom');
        }
      } catch {
        // One failed poll is not worth interrupting someone who is waiting.
      }
    }, KNOCK_POLL_MS);

    return () => clearInterval(timer);
  }, [phase, knockId, code]);

  if (phase === 'loading') return <Loading label="Opening the meeting" />;

  if (phase === 'live' && grant) {
    return (
      <CallView
        code={code}
        meeting={meeting}
        grant={grant}
        user={user}
        onLeave={() => router.push('/meetings')}
        onClosed={(reason) => {
          setNotice(reason);
          setPhase('over');
        }}
      />
    );
  }

  return (
    <div className="greenroom">
      <div className="greenroom__card">
        {phase === 'waiting' ? (
          <WaitingCard
            meeting={meeting}
            onCancel={async () => {
              await meetingApi.cancelKnock(code, knockId).catch(() => {});
              setKnockId(null);
              setPhase('greenroom');
            }}
          />
        ) : phase === 'over' ? (
          <OverCard
            meeting={meeting}
            error={error}
            errorCode={errorCode}
            notice={notice}
            code={code}
            onBack={() => router.push('/meetings')}
          />
        ) : (
          <GreenRoomCard
            meeting={meeting}
            user={user}
            error={error}
            joining={joining}
            onJoin={join}
            onBack={() => router.push('/meetings')}
          />
        )}
      </div>
    </div>
  );
}

// ── The call ─────────────────────────────────────────────────────────────────

/**
 * Everything inside the call.
 *
 * The `MeetingRoom` is held in a ref rather than in state: it is a long-lived
 * object with sockets and transports attached, and putting it in state would
 * invite a re-render to replace it and drop everyone's media.
 */
function CallView({ code, meeting, grant, user, onLeave, onClosed }) {
  const roomRef = useRef(null);

  const [peers, setPeers] = useState(() => new Map());
  const [localCamera, setLocalCamera] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [micOn, setMicOn] = useState(!grant.startMuted);
  const [cameraOn, setCameraOn] = useState(!grant.startCameraOff);
  const [screenOn, setScreenOn] = useState(false);
  const [knocks, setKnocks] = useState([]);
  const [chat, setChat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [role, setRole] = useState(grant.role);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // 'people' | 'chat' | 'info'

  const isHost = role === 'host' || role === 'cohost';

  /**
   * Peers live in a Map; every update replaces it so React sees the change.
   *
   * An update for a peer we have never heard of is dropped rather than
   * conjuring one. A missing id used to become a participant whose name was the
   * id — and when that id was null, a nameless phantom tile that crashed the
   * grid. If the server has told us about somebody, they are in this map.
   */
  const updatePeer = useCallback((texorId, change) => {
    if (!texorId) return;

    setPeers((current) => {
      const existing = current.get(texorId);
      if (!existing) return current;

      const next = new Map(current);
      next.set(texorId, { ...existing, ...change(existing) });
      return next;
    });
  }, []);

  /** Adding someone is explicit, and is the only way into the map. */
  const addPeer = useCallback((peer) => {
    if (!peer?.texorId) return;
    setPeers((current) => {
      const next = new Map(current);
      next.set(peer.texorId, { ...current.get(peer.texorId), ...peer, tracks: {} });
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const room = new MeetingRoom(code, {
      // Arrives before any track is consumed, so the tracks that follow land on
      // top of this rather than being wiped by it.
      roster: (list) =>
        setPeers(new Map(list.map((peer) => [peer.texorId, { ...peer, tracks: {} }]))),

      peerJoined: (peer) => addPeer(peer),

      peerLeft: (texorId) =>
        setPeers((current) => {
          const next = new Map(current);
          next.delete(texorId);
          return next;
        }),

      track: ({ peerTexorId, source, track }) =>
        updatePeer(peerTexorId, (existing) => ({
          tracks: { ...existing.tracks, [source]: track },
        })),

      trackEnded: (peerTexorId, source) =>
        updatePeer(peerTexorId, (existing) => {
          const tracks = { ...existing.tracks };
          delete tracks[source];
          return { tracks };
        }),

      peerMediaToggled: (peerTexorId, kind, paused) =>
        updatePeer(peerTexorId, () => (kind === 'audio' ? { muted: paused } : { cameraOff: paused })),

      knocks: setKnocks,
      knockResolved: (knockId) => setKnocks((current) => current.filter((k) => k.id !== knockId)),

      chat: (entry) => {
        setChat((current) => [...current.slice(-99), entry]);
        // Counted against the panel as it was when the message arrived, so a
        // message that lands while chat is open is never marked unread.
        setPanel((open) => {
          if (open !== 'chat') setUnread((count) => count + 1);
          return open;
        });
      },

      localTrackEnded: (source) => {
        if (source !== 'screen') return;
        setLocalScreen(null);
        setScreenOn(false);
      },

      reaction: (entry) =>
        setReactions((current) => [...current, { ...entry, key: `${entry.texorId}-${entry.at}-${Math.random()}` }]),

      roleChanged: ({ role: next }) => setRole(next),
      peerRoleChanged: ({ texorId, role: next }) => updatePeer(texorId, () => ({ role: next })),
      removed: (reason) => onClosed(reason),
      ended: (reason) => onClosed(reason),
      closed: (reason) => { if (!cancelled) onClosed(reason || 'You left the meeting.'); },
      error: (message) => setError(message),
      warning: (message) => setError(message),
    });

    roomRef.current = room;

    room
      .connect()
      .then(async () => {
        if (cancelled) return;

        setStatus('live');

        // Microphone first: a call where people can hear but not see each other
        // still works, and the reverse does not.
        await room.startMic().catch(() => setError('Could not use your microphone.'));
        if (grant.startMuted) await room.setPaused('mic', true);

        if (!grant.startCameraOff) {
          const track = await room.startCamera().catch(() => null);
          if (track) setLocalCamera(track);
          else {
            setCameraOn(false);
            setError('Could not use your camera. You are still in the meeting.');
          }
        }
      })
      .catch((connectError) => {
        if (!cancelled) onClosed(connectError.message);
      });

    return () => {
      cancelled = true;
      room.close();
    };
  }, [code, grant, updatePeer, addPeer, onClosed]);

  // A picker left open behind a click elsewhere is a small thing that feels
  // broken, and Escape is what people try first.
  useEffect(() => {
    if (!pickerOpen) return undefined;

    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target.closest?.('.meet__reaction-wrap')) return;
      setPickerOpen(false);
    };

    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [pickerOpen]);

  // A host should not have to go looking for someone waiting at the door.
  useEffect(() => {
    if (knocks.length > 0 && isHost) setPanel((open) => open ?? 'people');
  }, [knocks.length, isHost]);

  const openPanel = (which) => {
    setPanel((open) => (open === which ? null : which));
    if (which === 'chat') setUnread(0);
    // A pushed list is a single delivery. Opening the panel is the moment a
    // host actually wants the truth, so ask for it rather than trusting that
    // every push since joining arrived.
    if (which === 'people' && isHost) roomRef.current?.refreshKnocks().catch(() => {});
  };

  /**
   * Admit or deny, once.
   *
   * The entry is removed before the request goes out, so a second click cannot
   * decide the same knock twice — the server refuses the duplicate with "that
   * request is no longer waiting", and previously that refusal was an unhandled
   * promise rejection because nothing was catching it.
   */
  async function decideKnock(knockId, decision) {
    setKnocks((current) => current.filter((entry) => entry.id !== knockId));

    try {
      await roomRef.current?.admit(knockId, decision);
    } catch (decideError) {
      // Already handled by another host is not worth interrupting anyone over.
      if (decideError.code !== 'gone') setError(decideError.message);
    }
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room.has('mic')) {
      const track = await room.startMic().catch(() => null);
      if (!track) return setError('Could not use your microphone.');
      return setMicOn(true);
    }
    await room.setPaused('mic', micOn);
    return setMicOn(!micOn);
  }

  async function toggleCamera() {
    const room = roomRef.current;

    if (cameraOn) {
      await room.stop('camera');
      setLocalCamera(null);
      return setCameraOn(false);
    }

    const track = await room.startCamera().catch(() => null);
    if (!track) return setError('Could not use your camera.');
    setLocalCamera(track);
    return setCameraOn(true);
  }

  async function toggleScreen() {
    const room = roomRef.current;

    if (screenOn) {
      await room.stop('screen');
      setLocalScreen(null);
      return setScreenOn(false);
    }

    try {
      const track = await room.startScreen();
      // Only claim to be presenting once there is something to present. This
      // used to be set unconditionally, so a share that never started still
      // flipped the button to "Stop presenting".
      if (!track) throw new Error('Screen sharing did not start.');
      setLocalScreen(track);
      setScreenOn(true);
    } catch (shareError) {
      setLocalScreen(null);
      setScreenOn(false);
      /**
       * Everything except a deliberate cancel is shown.
       *
       * This previously surfaced only `forbidden`, so every other failure —
       * a codec the browser would not encode, a transport that had gone away,
       * a refusal with any other code — looked like the button doing nothing
       * at all. A silent control is worse than an error message.
       */
      if (!shareError.cancelled) setError(shareError.message);
    }
    return undefined;
  }

  async function leave() {
    roomRef.current?.close();
    await meetingApi.leave(code).catch(() => {});
    onLeave();
  }

  /**
   * Who is presenting, and — for us — deliberately without the picture.
   *
   * Rendering our own share back to us is what produces the hall-of-mirrors:
   * share the whole screen, and the screen contains a window showing the screen,
   * which contains a window showing the screen. Every video product answers this
   * the same way, by showing the presenter a card instead of their own feed.
   * They can already see what they are sharing — it is on their screen.
   */
  const presenting = useMemo(() => {
    if (localScreen) return { track: null, name: user.displayName, isYou: true };
    for (const peer of peers.values()) {
      if (peer.tracks.screen) return { track: peer.tracks.screen, name: peer.name };
    }
    return null;
  }, [peers, localScreen, user.displayName]);

  const everyone = [...peers.values()];
  const tileCount = everyone.length + 1;

  const selfTile = (
    <VideoTile
      key="self"
      track={localCamera}
      name={user.displayName}
      role={role}
      isYou
      mirrored
      muted={!micOn}
      compact={Boolean(presenting)}
    />
  );

  const peerTiles = everyone.map((peer) => (
    <VideoTile
      key={peer.texorId}
      track={peer.tracks.camera}
      name={peer.name}
      role={peer.role}
      muted={peer.muted}
      compact={Boolean(presenting)}
    />
  ));

  return (
    <div className="meet">
      <main className={`meet__stage ${panel ? 'meet__stage--panelled' : ''}`}>
        {error ? (
          <div className="meet__toast" role="alert">
            {error}
            <button type="button" className="meet__toast-close" onClick={() => setError(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        ) : null}

        {status !== 'live' ? (
          <div className="meet__connecting">
            <span className="spinner" aria-hidden="true" />
            <span>Joining&hellip;</span>
          </div>
        ) : null}

        {presenting ? (
          <div className="meet__present">
            <div className="meet__present-main">
              {presenting.isYou ? (
                <div className="meet__presenting-self">
                  <PresentIcon />
                  <p>You are presenting to everyone</p>
                  <span className="meet__muted">
                    Your own screen is not shown back to you, so it cannot mirror itself.
                  </span>
                  <button type="button" className="meet__chip meet__chip--primary" onClick={toggleScreen}>
                    Stop presenting
                  </button>
                </div>
              ) : (
                <VideoTile track={presenting.track} name={presenting.name} label="screen" />
              )}
            </div>
            <div className="meet__strip">{[selfTile, ...peerTiles]}</div>
          </div>
        ) : (
          <div className="meet__grid" data-count={Math.min(tileCount, 12)}>
            {[selfTile, ...peerTiles]}
          </div>
        )}

        <ReactionLayer reactions={reactions} onDone={(key) =>
          setReactions((current) => current.filter((entry) => entry.key !== key))} />

        {/* Remote audio is played, never shown. One element per peer so one
            failing track cannot silence everybody else. */}
        {everyone.map((peer) => (
          <Fragment key={`${peer.texorId}-audio`}>
            {peer.tracks.mic ? <RemoteAudio track={peer.tracks.mic} /> : null}
            {/* Program audio from someone else's share. We never play back our
                own — the SFU does not send us our own producers — which is what
                stops a presenter hearing their content a round trip late. */}
            {peer.tracks.screenAudio ? <RemoteAudio track={peer.tracks.screenAudio} /> : null}
          </Fragment>
        ))}
      </main>

      {panel ? (
        <SidePanel
          panel={panel}
          onClose={() => setPanel(null)}
          meeting={meeting}
          user={user}
          role={role}
          isHost={isHost}
          peers={everyone}
          knocks={knocks}
          chat={chat}
          room={roomRef}
          onError={setError}
          onDecide={decideKnock}
        />
      ) : null}

      <footer className="meet__bar">
        <div className="meet__bar-left">
          <Clock />
          <span className="meet__divider" aria-hidden="true" />
          <span className="meet__code">{meeting?.code}</span>
        </div>

        <div className="meet__controls">
          <ControlButton
            on={micOn}
            onClick={toggleMic}
            label={micOn ? 'Turn off microphone' : 'Turn on microphone'}
            icon={micOn ? <MicIcon /> : <MicOffIcon />}
          />
          <ControlButton
            on={cameraOn}
            onClick={toggleCamera}
            label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
            icon={cameraOn ? <CameraIcon /> : <CameraOffIcon />}
          />
          <div className="meet__reaction-wrap">
            {pickerOpen ? (
              <div className="meet__picker" role="menu">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    className="meet__picker-btn"
                    aria-label={`React with ${emoji}`}
                    onClick={() => {
                      roomRef.current?.sendReaction(emoji).catch(() => {});
                      setPickerOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <ControlButton
              on
              active={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
              label="Send a reaction"
              icon={<ReactionIcon />}
            />
          </div>

          {grant.canShareScreen || isHost ? (
            <ControlButton
              on
              active={screenOn}
              onClick={toggleScreen}
              label={screenOn ? 'Stop presenting' : 'Present now'}
              icon={screenOn ? <PresentOffIcon /> : <PresentIcon />}
            />
          ) : null}

          <button type="button" className="meet__hangup" onClick={leave} aria-label="Leave call">
            <HangUpIcon />
          </button>
        </div>

        <div className="meet__bar-right">
          <PanelButton
            active={panel === 'info'}
            onClick={() => openPanel('info')}
            label="Meeting details"
            icon={<InfoIcon />}
          />
          <PanelButton
            active={panel === 'people'}
            onClick={() => openPanel('people')}
            label="People"
            icon={<PeopleIcon />}
            count={tileCount}
            alert={isHost && knocks.length > 0}
          />
          {meeting?.settings?.allowChat ? (
            <PanelButton
              active={panel === 'chat'}
              onClick={() => openPanel('chat')}
              label="Chat"
              icon={<ChatIcon />}
              count={unread || undefined}
              alert={unread > 0}
            />
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** A round control. Red and filled when the thing it controls is off. */
function ControlButton({ on, active, onClick, label, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active ?? !on}
      className={[
        'meet__control',
        on ? '' : 'meet__control--off',
        active ? 'meet__control--active' : '',
      ].filter(Boolean).join(' ')}
    >
      {icon}
    </button>
  );
}

function PanelButton({ active, onClick, label, icon, count, alert }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`meet__tool ${active ? 'meet__tool--active' : ''}`}
    >
      {icon}
      {count ? <span className={`meet__count ${alert ? 'meet__count--alert' : ''}`}>{count}</span> : null}
    </button>
  );
}

/** Meet shows the time beside the code; it is the clock people actually read. */
function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="meet__time">
      {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

// ── The side panel ───────────────────────────────────────────────────────────

function SidePanel({ panel, onClose, meeting, user, role, isHost, peers, knocks, chat, room, onError, onDecide }) {
  const titles = { people: 'People', chat: 'In-call messages', info: 'Meeting details' };

  return (
    <aside className="meet__panel">
      <header className="meet__panel-head">
        <h2>{titles[panel]}</h2>
        <button type="button" className="meet__tool" onClick={onClose} aria-label="Close panel">
          <CloseIcon />
        </button>
      </header>

      <div className="meet__panel-body">
        {panel === 'people' ? (
          <PeoplePanel
            user={user} role={role} isHost={isHost} peers={peers} knocks={knocks}
            room={room} onError={onError} onDecide={onDecide}
          />
        ) : null}
        {panel === 'chat' ? <ChatPanel chat={chat} room={room} user={user} /> : null}
        {panel === 'info' ? <InfoPanel meeting={meeting} /> : null}
      </div>
    </aside>
  );
}

function PeoplePanel({ user, role, isHost, peers, knocks, room, onError, onDecide }) {
  return (
    <>
      {isHost && knocks.length > 0 ? (
        <section className="meet__section">
          <h3>Waiting to join</h3>
          {knocks.map((knock) => (
            <div className="meet__knock" key={knock.id}>
              <span className="meet__knock-avatar">
                {(knock.name ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="grow">
                <strong>{knock.name}</strong>
                <div className="meet__muted">
                  {knock.isExternal ? 'Outside your organisation' : knock.email}
                </div>
              </div>
              <button
                type="button" className="meet__chip meet__chip--primary"
                onClick={() => onDecide(knock.id, 'admit')}
              >
                Admit
              </button>
              <button
                type="button" className="meet__chip"
                onClick={() => onDecide(knock.id, 'deny')}
              >
                Deny
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="meet__section">
        <h3>In the call ({peers.length + 1})</h3>

        <div className="meet__person">
          <span className="meet__knock-avatar">
            {(user.displayName ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="grow">
            <strong>{user.displayName} (You)</strong>
            {role !== 'guest' ? <div className="meet__muted">{role}</div> : null}
          </div>
        </div>

        {peers.map((peer) => (
          <div className="meet__person" key={peer.texorId}>
            <span className="meet__knock-avatar">{(peer.name ?? '?').slice(0, 1).toUpperCase()}</span>
            <div className="grow">
              <strong>{peer.name}</strong>
              {peer.role === 'host' || peer.role === 'cohost' ? (
                <div className="meet__muted">{peer.role}</div>
              ) : null}
            </div>
            {peer.muted ? <span className="meet__muted-icon"><MicOffIcon /></span> : null}
            {role === 'host' ? (
              <button
                type="button"
                className="meet__tool meet__tool--sm"
                aria-label={`Remove ${peer.name}`}
                title={`Remove ${peer.name}`}
                onClick={() => room.current?.removePeer(peer.texorId).catch((e) => onError(e.message))}
              >
                <RemovePersonIcon />
              </button>
            ) : null}
          </div>
        ))}
      </section>
    </>
  );
}

function ChatPanel({ chat, room, user }) {
  const [draft, setDraft] = useState('');
  const end = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length]);

  return (
    <div className="meet__chat">
      <div className="meet__chat-log">
        <p className="meet__chat-note">
          Messages can be seen only by people in the call, and are lost when it ends.
        </p>
        {chat.map((entry, index) => {
          // Consecutive messages from one person read as one block, the way
          // every chat client people already use does it.
          const grouped = index > 0 && chat[index - 1].texorId === entry.texorId;
          return (
            <div className={`meet__chat-msg ${grouped ? 'meet__chat-msg--grouped' : ''}`} key={index}>
              {!grouped ? (
                <div className="meet__chat-meta">
                  <strong>{entry.texorId === user.texorId ? 'You' : entry.from}</strong>
                  <span>
                    {new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ) : null}
              <div className="meet__chat-body">{entry.body}</div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form
        className="meet__chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (!body) return;
          room.current?.sendChat(body).catch(() => {});
          setDraft('');
        }}
      >
        <input
          className="meet__chat-input"
          placeholder="Send a message"
          aria-label="Send a message to everyone in the call"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="meet__tool" disabled={!draft.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

function InfoPanel({ meeting }) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="meet__section">
      <h3>Joining info</h3>
      <p className="meet__join-link">{meeting?.joinUrl}</p>

      <button
        type="button"
        className="meet__chip meet__chip--primary"
        onClick={async () => {
          await navigator.clipboard?.writeText(meeting.joinUrl).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy joining info'}
      </button>

      {meeting?.agenda ? (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Agenda</h3>
          <p className="meet__muted">{meeting.agenda}</p>
        </>
      ) : null}

      <h3 style={{ marginTop: '1.5rem' }}>Host</h3>
      <p className="meet__muted">{meeting?.host?.name}</p>
    </section>
  );
}

/**
 * Reactions drifting up over the stage.
 *
 * Each one removes itself when its animation ends, so nothing accumulates in
 * state during a long call. `animationend` rather than a timer, so the two
 * cannot drift apart and leave an invisible element behind.
 */
function ReactionLayer({ reactions, onDone }) {
  if (reactions.length === 0) return null;

  return (
    <div className="meet__reactions" aria-live="polite">
      {reactions.map((entry) => (
        <span
          key={entry.key}
          className="meet__reaction"
          // Spread across the width so two at once do not overlap exactly.
          style={{ left: `${8 + (Math.abs(hashOf(entry.key)) % 72)}%` }}
          onAnimationEnd={() => onDone(entry.key)}
        >
          <span className="meet__reaction-emoji">{entry.emoji}</span>
          <span className="meet__reaction-name">{entry.name}</span>
        </span>
      ))}
    </div>
  );
}

function hashOf(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return hash;
}

function RemoteAudio({ track }) {
  const element = useRef(null);

  useEffect(() => {
    const audio = element.current;
    if (!audio || !track) return undefined;

    audio.srcObject = new MediaStream([track]);
    audio.play?.().catch(() => {});

    return () => { audio.srcObject = null; };
  }, [track]);

  return <audio ref={element} autoPlay hidden />;
}

// ── Screens ──────────────────────────────────────────────────────────────────

function GreenRoomCard({ meeting, user, error, joining, onJoin, onBack }) {
  const lobbyApplies =
    meeting &&
    !meeting.viewer.isHost &&
    (meeting.lobby === 'everyone' ||
      (meeting.lobby === 'external' && (meeting.viewer.isExternal || meeting.viewer.role === 'guest')));

  return (
    <>
      <div>
        <span className="badge">{meeting?.status === 'live' ? 'In progress' : 'Ready'}</span>
        <h1 style={{ marginTop: '0.6rem' }}>{meeting?.title}</h1>
        <p className="meta" style={{ marginTop: '0.35rem' }}>
          Hosted by {meeting?.host?.name}
          {meeting?.participantCount > 0
            ? ` · ${meeting.participantCount} already here`
            : ' · nobody here yet'}
        </p>
      </div>

      {meeting?.agenda ? <p style={{ color: 'var(--text-muted)' }}>{meeting.agenda}</p> : null}

      <Alert kind="error">{error}</Alert>

      {lobbyApplies ? (
        <Alert kind="info">You will wait in the lobby until a host lets you in.</Alert>
      ) : null}

      <div className="row" style={{ gap: '0.6rem' }}>
        <Avatar user={user} />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontWeight: 550 }}>{user.displayName}</div>
          <span className="meta">Joining as your Texor Account</span>
        </div>
      </div>

      <p className="meta">Your browser will ask for the microphone and camera once you join.</p>

      <div className="row" style={{ gap: '0.6rem' }}>
        <Button onClick={onJoin} loading={joining}>
          {meeting?.viewer?.isHost && meeting?.status !== 'live' ? 'Start the meeting' : 'Join now'}
        </Button>
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
    </>
  );
}

function WaitingCard({ meeting, onCancel }) {
  return (
    <>
      <div>
        <h1>Waiting to be let in</h1>
        <p className="meta" style={{ marginTop: '0.35rem' }}>
          {meeting?.host?.name} has been asked to admit you to {meeting?.title}.
        </p>
      </div>

      <div className="row" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" aria-hidden="true" />
        <span role="status">Asking the host&hellip;</span>
      </div>

      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
    </>
  );
}

function OverCard({ meeting, error, errorCode, notice, code, onBack }) {
  /**
   * A code that does not resolve is almost always an old link, not a typo.
   *
   * Meetings are deleted, cancelled, or simply never existed, and the link
   * outlives all three — in a calendar entry, a pinned tab, a chat message from
   * last month. Saying so and offering the way forward is more use than an
   * error and a dead end.
   */
  const missing = errorCode === 'not_found';

  return (
    <>
      <div>
        <h1>{missing ? 'This meeting no longer exists' : error ? 'Cannot join' : 'Meeting ended'}</h1>
        {meeting?.title ? <p className="meta" style={{ marginTop: '0.35rem' }}>{meeting.title}</p> : null}
      </div>

      {missing ? (
        <>
          <p style={{ color: 'var(--text-muted)' }}>
            Nothing is using the code <span className="code">{code}</span>. It may have been
            cancelled, or the link may be an old one.
          </p>
          <div className="row" style={{ gap: '0.6rem' }}>
            <Button onClick={onBack}>See your meetings</Button>
          </div>
        </>
      ) : (
        <>
          <Alert kind={error ? 'error' : 'info'}>{error ?? notice ?? 'This meeting is over.'}</Alert>
          <Button onClick={onBack}>Back to meetings</Button>
        </>
      )}
    </>
  );
}
