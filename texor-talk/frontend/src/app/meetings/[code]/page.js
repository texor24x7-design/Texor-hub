'use client';

import { Fragment, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { VideoTile } from '@/components/VideoTile';
import { Alert, Avatar, Button, Field, Loading, Logo } from '@/components/ui';
import {
  CameraIcon, CameraOffIcon, ChatIcon, CheckIcon, CloseIcon, CopyIcon, HangUpIcon,
  InfoIcon, MicIcon, MicOffIcon, PeopleIcon, PresentIcon, PresentOffIcon,
  ChevronIcon, GridIcon, HandIcon, PinIcon, ReactionIcon, RemovePersonIcon, SendIcon,
  ShieldIcon,
  TuneIcon,
  NotesIcon,
  SearchIcon,
} from '@/components/icons';
import { SettingsDialog } from '@/components/SettingsDialog';
import { joinDefaults, joinPatch, loadPreferences, savePreferences } from '@/lib/preferences';

/** Must match the server's allowlist in media/signalling.js. */
const REACTIONS = ['👍', '👎', '❤️', '🎉', '👏', '😂', '😮', '😢', '🤔', '✋'];
import { auth, meetings as meetingApi, signInWithTexor } from '@/lib/api';
import { MeetingNotes } from '@/components/MeetingNotes';
import { MeetingTimer } from '@/components/MeetingTimer';
import { ConnectionInfo } from '@/components/ConnectionInfo';
import { createChimes } from '@/lib/sounds';
import { chooseStage, showInviteInstead } from '@/lib/stage';
import { MeetingRoom } from '@/lib/room';
import { describeMediaError } from '@/lib/media-errors';
import { bestTileLayout } from '@/lib/tile-layout';

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

/**
 * `getDisplayMedia` simply does not exist on mobile browsers.
 *
 * iOS Safari and Android Chrome have no API for capturing a screen, so the
 * button cannot be made to work there — offering it and failing is worse than
 * not offering it, which is why this is checked rather than attempted.
 */
const canCaptureScreen = () =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

/**
 * Turns a peer summary into what a tile needs.
 *
 * The server already says, per producer, what kind it is and whether it is
 * paused. Throwing that away — which the roster used to do — meant somebody who
 * joined muted showed as unmuted until they happened to toggle, and every
 * indicator read backwards until then. Derived, never assumed.
 */
function hydrate(peer, existing = {}) {
  const producers = peer.producers ?? existing.producers ?? [];
  const mic = producers.find((p) => p.source === 'mic');
  const camera = producers.find((p) => p.source === 'camera');

  return {
    ...existing,
    ...peer,
    // Kept explicitly: a roster entry that omitted it would blank the face.
    picture: peer.picture ?? existing.picture ?? '',
    screenAt: existing.screenAt ?? 0,
    producers,
    tracks: existing.tracks ?? {},
    // No microphone producer at all is also muted: they have not started one.
    muted: !mic || mic.paused,
    cameraOff: !camera || camera.paused,
    handRaised: Boolean(peer.handRaised ?? existing.handRaised),
  };
}

export default function MeetingPage({ params }) {
  const { code } = use(params);
  return <MeetingEntry code={code} />;
}

/**
 * Who is arriving, before anything else is decided.
 *
 * A meeting link is the one place in this product that has to work for somebody
 * with no account, so this page cannot sit behind the usual `AppShell` bounce to
 * sign-in. It asks who the caller is once: a Texor session goes down the normal
 * path, and anybody else is offered a name box — but only if the meeting itself
 * has been opened to guests, which the server decides, not this component.
 */
function MeetingEntry({ code }) {
  const [state, setState] = useState({ phase: 'checking' });

  const load = useCallback(async () => {
    try {
      const { user } = await auth.me();

      if (user && !user.isGuest) return setState({ phase: 'member', user });

      /**
       * A guest pass already in the browser, from a refresh or a second tab.
       * It is only good for the meeting it was issued for — anything else and
       * they are treated as a new arrival and offered the name box again.
       */
      if (user?.isGuest && user.meetingCode === code) {
        return setState({ phase: 'guest-joined', user });
      }
    } catch {
      // Not signed in is not an error here; it is the other half of the flow.
    }

    try {
      const preview = await meetingApi.guestPreview(code);
      return setState({ phase: 'guest', preview });
    } catch (previewError) {
      return setState({ phase: 'unavailable', message: previewError.message });
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  if (state.phase === 'checking') return <Loading label="Opening the meeting" />;

  // Signed in: the ordinary path, with the usual chrome around it.
  if (state.phase === 'member') {
    return <AppShell>{(user) => <MeetingScreen code={code} user={user} />}</AppShell>;
  }

  /**
   * A guest goes straight to the meeting, with no `AppShell`.
   *
   * `AppShell` exists to guarantee a Texor session and bounces to sign-in when
   * there is not one — which is exactly what a guest does not have. Rendering it
   * around them sent somebody who had *just* successfully joined by name
   * straight to the sign-in page. They also get no product navigation, which is
   * correct: a guest pass opens this meeting and nothing else.
   */
  if (state.phase === 'guest-joined') {
    return <MeetingScreen code={code} user={state.user} />;
  }

  if (state.phase === 'guest') {
    return (
      <GuestEntry
        code={code}
        preview={state.preview}
        onJoined={(guest) => setState({ phase: 'guest-joined', user: guest })}
      />
    );
  }

  return (
    <div className="greenroom greenroom--slim">
      <div className="greenroom__card">
        <h1>This meeting is not available</h1>
        <Alert kind="error">{state.message}</Alert>
        <Button onClick={() => { window.location.href = '/meetings'; }}>Go to Texor Talk</Button>
      </div>
    </div>
  );
}

/**
 * The name box.
 *
 * Deliberately offers signing in as the first option rather than the
 * afterthought: somebody with a Texor Account gets a real identity in the
 * attendance record and skips the lobby, and both are better for them and for
 * whoever is hosting.
 */
function GuestEntry({ code, preview, onJoined }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { allowed, reason, willWait } = preview.guests;

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const { guest } = await meetingApi.joinAsGuest(code, name.trim());
      onJoined({ ...guest, isAdmin: false });
    } catch (joinError) {
      setError(joinError.message);
      setBusy(false);
    }
  }

  return (
    <div className="greenroom greenroom--slim">
      <div className="greenroom__card">
        <Logo />

        <div>
          <h1 style={{ marginTop: '0.5rem' }}>{preview.meeting.title}</h1>
          <p className="meta" style={{ marginTop: '0.35rem' }}>
            Hosted by {preview.meeting.hostName}
          </p>
        </div>

        {allowed ? (
          <>
            <form className="stack stack--tight" onSubmit={submit}>
              <Alert kind="error">{error}</Alert>

              <Field
                label="Your name"
                hint="This is what everyone in the meeting will see."
                htmlFor="guestName"
              >
                <input
                  id="guestName"
                  className="input"
                  autoFocus
                  maxLength={60}
                  placeholder="e.g. Sam Rivera"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              {willWait ? (
                <Alert kind="info">
                  You will wait in the lobby until a host lets you in.
                </Alert>
              ) : null}

              <Button type="submit" loading={busy} disabled={!name.trim()} block>
                Ask to join
              </Button>
            </form>

            <div className="greenroom__alt">
              <span className="meta">Have a Texor Account?</span>
              <Button variant="secondary" size="sm" onClick={() => signInWithTexor(`/meetings/${code}`)}>
                Sign in instead
              </Button>
            </div>
          </>
        ) : (
          <>
            <Alert kind="info">{reason}</Alert>
            <Button onClick={() => signInWithTexor(`/meetings/${code}`)} block>
              Sign in with Texor
            </Button>
          </>
        )}
      </div>
    </div>
  );
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
  const [prefs, setPrefs] = useState(null);

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

  const join = useCallback(async (preferences) => {
    setJoining(true);
    setError(null);
    // Carried into the call so nobody is asked twice about the same devices.
    setPrefs(preferences ?? null);

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
        prefs={prefs}
        user={user}
        onLeave={() => router.push(user.isGuest ? `/meetings/${code}` : '/meetings')}
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
function CallView({ code, meeting, grant, prefs, user, onLeave, onClosed }) {
  /**
   * What the green room chose, narrowed by what the meeting allows.
   *
   * A host can require everyone to arrive muted, and that has to win over
   * somebody's preference — but only in that direction. Nobody is ever forced
   * *on*, which is why these are `&&` rather than a straight override.
   */
  const wanted = {
    mic: (prefs?.micOn ?? true) && !grant.startMuted,
    camera: (prefs?.cameraOn ?? true) && !grant.startCameraOff,
    devices: prefs?.devices ?? {},
  };

  /**
   * The call's chimes.
   *
   * Built once per call rather than per render, and armed only when the call
   * actually goes live — the gate refuses everything before that, so opening a
   * meeting already full of people does not announce every one of them.
   */
  const chimes = useRef(null);
  if (!chimes.current) chimes.current = createChimes({ enabled: prefs?.sounds !== false });

  const roomRef = useRef(null);

  /**
   * Set the moment we decide to go, and never cleared.
   *
   * Read by `onClosed` so that a departure we started ourselves does not get
   * reported back to us as the meeting ending. A ref rather than state because
   * it is read inside callbacks that were created before the render that would
   * have updated it.
   */
  const leavingRef = useRef(false);

  const [peers, setPeers] = useState(() => new Map());
  const [localCamera, setLocalCamera] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [micOn, setMicOn] = useState(wanted.mic);
  const [cameraOn, setCameraOn] = useState(wanted.camera);
  const [screenOn, setScreenOn] = useState(false);
  const [knocks, setKnocks] = useState([]);
  const [chat, setChat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speaking, setSpeakingRaw] = useState(null);
  const clearSpeaking = useRef(null);

  /**
   * Turning the highlight *off* waits; turning it on does not.
   *
   * Silence is reported during the gaps between words as well as at the end of
   * a sentence, so clearing immediately makes the ring strobe while somebody is
   * still mid-thought. A new speaker replaces the old one at once — only the
   * emptying is held back.
   */
  const setSpeaking = useCallback((texorId) => {
    clearTimeout(clearSpeaking.current);

    if (texorId) {
      setSpeakingRaw(texorId);
      return;
    }
    clearSpeaking.current = setTimeout(() => setSpeakingRaw(null), 900);
  }, []);

  useEffect(() => () => clearTimeout(clearSpeaking.current), []);
  const [myHand, setMyHand] = useState(false);
  const [connection, setConnection] = useState({ state: 'live' });
  const [settingsTab, setSettingsTab] = useState(null);
  /**
   * The stored settings, distinct from `prefs`.
   *
   * `prefs` is what the green room chose for this one join; these are the
   * durable per-browser preferences. Re-read when the dialog closes so a change
   * made mid-call takes effect without a rejoin.
   */
  const [settings, setSettings] = useState(() => loadPreferences());
  const [watchingId, setWatchingId] = useState(null);
  const [localScreenAt, setLocalScreenAt] = useState(0);

  /**
   * How the stage is arranged.
   *
   *   auto      spotlight whoever is presenting or talking, grid when neither
   *   tiled     everyone the same size, no promotion
   *   spotlight one person large with the rest in a strip
   *
   * `pinned` overrides all of it — an explicit choice outranks anything the
   * room works out for itself, and it stays put when somebody else speaks.
   */
  const [layout, setLayout] = useState('auto');
  const [pinned, setPinned] = useState(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [quality, setQuality] = useState(grant.quality?.tier ?? 'standard');
  const [qualityOptions, setQualityOptions] = useState(meeting?.qualityOptions ?? []);
  // Something happened that is worth saying but not worth interrupting for.
  const [notice, setNotice] = useState(null);
  // Shared by the code chip and the empty-room panel, so the two agree.
  const [copied, setCopied] = useState(false);
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
      next.set(peer.texorId, hydrate(peer, current.get(peer.texorId)));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const room = new MeetingRoom(code, {
      // Resolved by the server from the meeting's tier and the org ceiling.
      limits: grant.quality,

      // Arrives before any track is consumed, so the tracks that follow land on
      // top of this rather than being wiped by it.
      /**
       * Replace, but keep what we already have.
       *
       * This is the authoritative membership list, so anyone absent from it has
       * genuinely gone — but the live `MediaStreamTrack`s belong to us, not to
       * the server, and rebuilding the map from scratch would throw away every
       * video in the call several times a minute.
       */
      roster: (list) =>
        setPeers((current) => {
          const next = new Map();
          for (const peer of list) next.set(peer.texorId, hydrate(peer, current.get(peer.texorId)));
          return next;
        }),

      peerJoined: (peer) => {
        addPeer(peer);
        // Hooked to the delta, not to the roster: reconciliation replays
        // everybody who is already here, and chiming for each of them is
        // exactly the noise this is meant to avoid.
        chimes.current?.play('join');
      },

      peerLeft: (texorId) => {
        chimes.current?.play('leave');
        setPeers((current) => {
          const next = new Map(current);
          next.delete(texorId);
          return next;
        });
      },

      track: ({ peerTexorId, source, track }) =>
        updatePeer(peerTexorId, (existing) => ({
          tracks: { ...existing.tracks, [source]: track },
          // Stamped so several simultaneous shares have a defined order, rather
          // than whichever the peer map happened to yield first.
          ...(source === 'screen' ? { screenAt: Date.now() } : {}),
        })),

      trackEnded: (peerTexorId, source) =>
        updatePeer(peerTexorId, (existing) => {
          const tracks = { ...existing.tracks };
          delete tracks[source];
          return { tracks };
        }),

      peerMediaToggled: (peerTexorId, kind, paused) =>
        updatePeer(peerTexorId, () => (kind === 'audio' ? { muted: paused } : { cameraOff: paused })),

      // Someone starting a track is also an indicator change — without this a
      // person who turns their microphone on still reads as muted.
      peerProducerAdded: ({ peerTexorId, kind, source }) =>
        updatePeer(peerTexorId, () => (
          source === 'mic' ? { muted: false } : source === 'camera' ? { cameraOff: false } : {}
        )),

      activeSpeaker: (texorId) => setSpeaking(texorId),


      handChanged: ({ texorId, raised }) => {
        if (texorId === user.texorId) setMyHand(raised);
        updatePeer(texorId, () => ({ handRaised: raised }));
      },

      forceMuted: ({ by }) => {
        setMicOn(false);
        setError(`${by} muted you. You can unmute yourself when you need to speak.`);
      },

      reconnecting: ({ attempt }) => setConnection({ state: 'reconnecting', attempt }),
      reconnected: () => {
        setConnection({ state: 'live' });
        // The first attempt may never have got this far, so this is also where
        // the stage stops saying "joining" when a retry is what got us in.
        setStatus('live');
        setError(null);
      },

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
        setLocalScreenAt(0);
        setScreenOn(false);
      },

      reaction: (entry) =>
        setReactions((current) => [...current, { ...entry, key: `${entry.texorId}-${entry.at}-${Math.random()}` }]),

      roleChanged: ({ role: next }) => setRole(next),
      peerRoleChanged: ({ texorId, role: next }) => updatePeer(texorId, () => ({ role: next })),
      /**
       * Being removed or the meeting ending are things done *to* us, so they
       * are worth a chime and a screen explaining what happened. Our own exit
       * is neither, and `leavingRef` is how the difference is told — the server
       * sends `ended` to everybody, including whoever caused it.
       */
      removed: (reason) => {
        if (leavingRef.current) return;
        chimes.current?.play('ended');
        onClosed(reason);
      },
      ended: (reason) => {
        if (leavingRef.current) return;
        chimes.current?.play('ended');
        onClosed(reason);
      },
      closed: (reason) => {
        if (cancelled || leavingRef.current) return;
        onClosed(reason || 'You left the meeting.');
      },
      /**
       * The host moved the meeting's bandwidth budget.
       *
       * Everyone is told, not only the host — the room has already re-aimed our
       * own senders by the time this runs, and saying so is the difference
       * between "the video just changed" and knowing why.
       */
      quality: ({ tier, name, changedBy }) => {
        setQuality(tier);
        setNotice(`${changedBy} set the video quality to ${name}.`);
      },

      error: (message) => setError(message),
      warning: (message) => setError(message),
    });

    roomRef.current = room;

    room
      .connect()
      .then(async () => {
        if (cancelled) return;

        setStatus('live');
        // Arming here rather than at construction: joining was a click, which
        // is what an AudioContext needs to start unsuspended.
        chimes.current?.arm();

        /**
         * The microphone is always opened, even when joining muted.
         *
         * Producing it now and pausing it makes unmuting instant later. Waiting
         * until someone clicks means a capture, a negotiation and a permission
         * check standing between them and being heard, which is the worst
         * possible moment for it.
         */
        await room
          .startMic(wanted.devices.mic)
          .catch((micError) => setError(describeMediaError(micError, 'audio')));
        if (!wanted.mic) await room.setPaused('mic', true);

        if (wanted.camera) {
          try {
            setLocalCamera(await room.startCamera(wanted.devices.camera));
          } catch (cameraError) {
            setCameraOn(false);
            setError(`${describeMediaError(cameraError, 'video')} You are still in the meeting.`);
          }
        }
      })
      .catch((connectError) => {
        if (cancelled) return;

        /**
         * Only a real refusal ends the meeting here.
         *
         * If the very first connection could not be made — the server was
         * restarting, the network blinked — the room is already retrying in the
         * background, and throwing the user out to "meeting ended" while that
         * happens is both wrong and unrecoverable. Show that it is reconnecting
         * and let the loop do its work.
         */
        if (connectError.retryable) {
          setConnection({ state: 'reconnecting', attempt: 1 });
          return;
        }
        onClosed(connectError.message);
      });

    return () => {
      cancelled = true;
      room.close();
      // Not immediately: the meeting-ended chime is playing as this runs, and
      // closing the context underneath it would cut it off halfway.
      chimes.current?.close();
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

  useEffect(() => {
    if (!layoutOpen) return undefined;

    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target.closest?.('.meet__layout-wrap')) return;
      setLayoutOpen(false);
    };

    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [layoutOpen]);

  useEffect(() => {
    if (!qualityOpen) return undefined;

    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target.closest?.('.meet__quality-wrap')) return;
      setQualityOpen(false);
    };

    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [qualityOpen]);

  /**
   * Somebody handed us the meeting mid-call.
   *
   * The tiers a host may choose from came with the meeting we fetched before
   * joining, and we fetched it as a participant — so a newly promoted host has
   * an empty list until we ask again. Cheap, and only on the promotion.
   */
  useEffect(() => {
    if (!isHost || qualityOptions.length > 0) return undefined;

    let cancelled = false;
    meetingApi.get(code)
      .then(({ meeting: fresh }) => { if (!cancelled) setQualityOptions(fresh?.qualityOptions ?? []); })
      .catch(() => {
        // Not being able to offer the menu is not a reason to disturb the call.
      });

    return () => { cancelled = true; };
  }, [isHost, qualityOptions.length, code]);

  // A notice reports something that already happened, so it takes itself away.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  async function changeRole(texorId, nextRole) {
    try {
      const { meeting: updated } = await meetingApi.setRole(code, texorId, nextRole);
      updatePeer(texorId, () => ({ role: nextRole }));
      if (updated) setError(null);
    } catch (roleError) {
      setError(roleError.message);
    }
  }

  async function toggleHand() {
    const next = !myHand;
    setMyHand(next);
    try {
      await roomRef.current?.raiseHand(next);
    } catch {
      setMyHand(!next);
    }
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room.has('mic')) {
      try {
        await room.startMic(wanted.devices.mic);
        return setMicOn(true);
      } catch (micError) {
        return setError(describeMediaError(micError, 'audio'));
      }
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

    try {
      const track = await room.startCamera(wanted.devices.camera);
      setLocalCamera(track);
      return setCameraOn(true);
    } catch (cameraError) {
      return setError(describeMediaError(cameraError, 'video'));
    }
  }

  async function toggleScreen() {
    const room = roomRef.current;

    if (screenOn) {
      await room.stop('screen');
      setLocalScreen(null);
      return setScreenOn(false);
    }

    try {
      /**
       * The choice from Settings, which used to go nowhere.
       *
       * `startScreen` has always taken a mode and set the track's
       * `contentHint` from it — but it was called with no argument, so every
       * share was "keep it smooth" regardless of what the reader picked. On a
       * shared spreadsheet that is the wrong trade and there was no way to
       * change it.
       */
      const track = await room.startScreen(settings.screenOptimise ?? 'motion');
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

  /**
   * Leaving.
   *
   * `leavingRef` is set before anything else happens. Closing the room makes
   * the server tell everybody the call is over, and that message comes back to
   * us too — so without this flag our own departure raced the redirect and
   * dropped us on the "Meeting ended" screen instead of taking us back to our
   * meetings. The flag is what distinguishes "I left" from "it ended".
   */
  async function leaveNow() {
    leavingRef.current = true;
    roomRef.current?.close();
    await meetingApi.leave(code).catch(() => {});

    // A guest pass has no purpose once its meeting is left, and leaving it in
    // the browser is a credential nobody is tracking.
    if (user.isGuest) await meetingApi.leaveAsGuest(code).catch(() => {});

    onLeave();
  }

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(meeting?.joinUrl ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied, or an insecure origin. The link is on screen either
      // way, so this is a nudge rather than a failure.
      setError('Could not copy \u2014 select the link and copy it by hand.');
    }
  }, [meeting?.joinUrl]);

  /**
   * Leaving, for everybody including the host.
   *
   * A host used to be stopped here and asked to nominate a successor before
   * they could go. It was a question the product can answer for itself — and
   * one it could not ask at all when a host simply lost their connection, which
   * is the common case. The room now hands itself to whoever is still in it,
   * so there is nothing left to decide. See `reconcileHost` in
   * `services/meeting.service.js`.
   */
  const leave = leaveNow;

  /**
   * Who is presenting, and — for us — deliberately without the picture.
   *
   * Rendering our own share back to us is what produces the hall-of-mirrors:
   * share the whole screen, and the screen contains a window showing the screen,
   * which contains a window showing the screen. Every video product answers this
   * the same way, by showing the presenter a card instead of their own feed.
   * They can already see what they are sharing — it is on their screen.
   */
  /**
   * Every screen being shared, newest first.
   *
   * More than one person can share at once — which is useful, and was
   * previously broken in a quiet way: the first share found in an unordered map
   * won, and any others were consumed (costing everybody bandwidth) but never
   * shown, with no way to reach them.
   */
  const shares = useMemo(() => {
    const all = [];

    if (localScreen) {
      all.push({
        texorId: user.texorId,
        name: user.displayName,
        track: localScreen,
        isYou: true,
        at: localScreenAt,
      });
    }

    for (const peer of peers.values()) {
      if (peer.tracks.screen) {
        all.push({
          texorId: peer.texorId,
          name: peer.name,
          track: peer.tracks.screen,
          at: peer.screenAt ?? 0,
        });
      }
    }

    return all.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }, [peers, localScreen, localScreenAt, user.texorId, user.displayName]);

  /**
   * Which share is on the stage.
   *
   * Defaults to the newest, because somebody starting to share has just decided
   * there is something everyone should look at. An explicit choice sticks until
   * that share ends.
   */
  const watching = shares.find((share) => share.texorId === watchingId) ?? shares[0] ?? null;

  useEffect(() => {
    // The chosen share ended; fall back rather than showing nothing.
    if (watchingId && !shares.some((share) => share.texorId === watchingId)) setWatchingId(null);
  }, [shares, watchingId]);

  const presenting = watching
    // Our own screen is never played back to us — see the note on the card.
    ? { track: watching.isYou ? null : watching.track, name: watching.name, isYou: watching.isYou }
    : null;

  /**
   * Who gets the big tile, and whether anybody does.
   *
   * The order is deliberate. A pin is an explicit instruction and outranks
   * everything, including a screen share. A screen share outranks the speaker,
   * because somebody sharing has something specific to show. Only then does the
   * active speaker get promoted, and only when the layout asks for it.
   *
   * `tiled` opts out entirely: some people want to see everybody all the time
   * and find a stage that rearranges itself when someone coughs unbearable.
   */
  /**
   * Which of the three views the stage is showing.
   *
   * The decision lives in `lib/stage.js` and is tested there over every
   * combination of layout, room size, pin and speaker. It used to be inline,
   * and a change to it reached a browser as a `TypeError` — the sort of thing
   * this file cannot be tested for, and that file can.
   */
  const stage = useMemo(
    () => chooseStage({
      pinned, presenting, layout, speaking, peers, localCamera,
      me: { texorId: user.texorId, displayName: user.displayName, picture: user.picture },
    }),
    [pinned, presenting, layout, speaking, peers, localCamera,
      user.texorId, user.displayName, user.picture],
  );

  const everyone = [...peers.values()];

  /**
   * Leaving a call nobody else joined.
   *
   * The setting offered this and nothing implemented it, so a meeting opened
   * by mistake — or one everybody else forgot about — sat holding a camera, a
   * microphone and a server slot until the machine was noticed.
   *
   * The clock only runs while you are genuinely alone, and any arrival stops
   * it for good rather than pausing it: somebody who joins and leaves again
   * has still shown the meeting is real. A minute before the end there is a
   * warning, because being dropped from a call with no notice is worse than
   * sitting in an empty one.
   */
  const ALONE_LIMIT_MS = 5 * 60_000;
  const aloneRef = useRef(false);

  useEffect(() => {
    if (settings.leaveEmpty === false) return undefined;
    // Once anybody has been here, this meeting is not an accident.
    if (everyone.length > 0) { aloneRef.current = true; return undefined; }
    if (aloneRef.current) return undefined;

    const warn = setTimeout(
      () => setNotice('Nobody else has joined. You will leave this meeting in a minute.'),
      ALONE_LIMIT_MS - 60_000,
    );
    const go = setTimeout(() => { leaveNow(); }, ALONE_LIMIT_MS);

    return () => { clearTimeout(warn); clearTimeout(go); };
    // `leaveNow` is stable for the life of the call; re-running on it would
    // restart the clock on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyone.length, settings.leaveEmpty]);
  const tileCount = everyone.length + 1;
  const alone = everyone.length === 0;
  const inviteInstead = showInviteInstead({ peerCount: everyone.length, cameraOn, status });

  /**
   * Tile size is computed, not guessed.
   *
   * The grid is measured and the largest arrangement that fits is worked out
   * from the real box — CSS on its own left tiles smaller than their cells and
   * pinned to a corner. Re-measured on resize, and when the headcount changes,
   * which is what makes the grid grow and shrink as people come and go.
   */
  const gridRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = gridRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [stage.mode]);

  const tiles = useMemo(
    () => bestTileLayout({ count: tileCount, width: box.width, height: box.height, gap: 8 }),
    [tileCount, box.width, box.height],
  );

  const selfTile = (
    <VideoTile
      key="self"
      track={localCamera}
      name={user.displayName}
      picture={user.picture}
      role={role}
      isYou
      mirrored
      muted={!micOn}
      handRaised={myHand}
      speaking={speaking === user.texorId && micOn}
      compact={stage.mode !== 'grid'}
    />
  );

  const peerTiles = everyone.map((peer) => (
    <VideoTile
      key={peer.texorId}
      track={peer.tracks.camera}
      name={peer.name}
      picture={peer.picture}
      role={peer.role}
      muted={peer.muted}
      handRaised={peer.handRaised}
      // Someone who is muted cannot be the one talking, whatever the observer
      // last said — the highlight would otherwise stick to them after a mute.
      speaking={speaking === peer.texorId && !peer.muted}
      compact={stage.mode !== 'grid'}
      onPin={() => setPinned((current) => (current === peer.texorId ? null : peer.texorId))}
      pinned={pinned === peer.texorId}
    />
  ));

  return (
    <div className="meet">
      <main className="meet__stage">
        {error ? (
          <div className="meet__toast" role="alert">
            {error}
            <button type="button" className="meet__toast-close" onClick={() => setError(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        ) : null}

        {notice && !error ? (
          <div className="meet__toast meet__toast--notice" role="status">
            {notice}
            <button type="button" className="meet__toast-close" onClick={() => setNotice(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        ) : null}

        {status !== 'live' || connection.state === 'reconnecting' ? (
          <div className="meet__connecting" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>
              {connection.state === 'reconnecting'
                ? `Reconnecting\u2026 (attempt ${connection.attempt})`
                : 'Joining\u2026'}
            </span>
            {connection.state === 'reconnecting' ? (
              <span className="meet__muted">Your meeting is still running.</span>
            ) : null}
          </div>
        ) : null}

        {/*
          * Alone, with nothing to look at.
          *
          * A single dark tile of your own face is a poor answer to "did this
          * work?". The link is the one thing somebody in an empty room needs,
          * so it is the thing on the screen. Once the camera is on there *is*
          * something to look at, and the tile takes over.
          */}
        {inviteInstead ? (
          <div className="meet__alone">
            <span className="meet__alone-art" aria-hidden="true"><CameraIcon /></span>
            <h2>You&rsquo;re the first one here</h2>
            <p>Share this meeting link to invite others</p>

            <div className="meet__alone-link">
              <span>{meeting?.joinUrl}</span>
              <button type="button" onClick={copyInvite} aria-label="Copy meeting link">
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>

            <button type="button" className="meet__alone-cta" onClick={copyInvite}>
              <PeopleIcon />
              {copied ? 'Link copied' : 'Invite people'}
            </button>
          </div>
        ) : stage.mode === 'grid' ? (
          <div
            className={`meet__grid ${tiles.scrolls ? 'meet__grid--scrolls' : ''}`}
            ref={gridRef}
            style={{ '--tile-w': `${tiles.tileWidth}px`, '--tile-h': `${tiles.tileHeight}px` }}
          >
            {[selfTile, ...peerTiles]}
          </div>
        ) : (
          <div className="meet__present">
            <div className="meet__present-main">
              {stage.mode === 'present' && stage.feature.isYou ? (
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
                <VideoTile
                  track={stage.feature.track}
                  name={stage.feature.name}
                  picture={stage.feature.isYou ? user.picture : stage.feature.picture}
                  role={stage.feature.role}
                  muted={stage.feature.isYou ? !micOn : stage.feature.muted}
                  handRaised={stage.feature.isYou ? myHand : stage.feature.handRaised}
                  speaking={!stage.feature.isYou && speaking === stage.feature.texorId}
                  mirrored={stage.feature.isYou && stage.mode !== 'present'}
                  isYou={stage.feature.isYou}
                  label={stage.mode === 'present' ? 'screen' : undefined}
                />
              )}

              {shares.length > 1 && stage.mode === 'present' ? (
                <div className="shares" role="group" aria-label="Shared screens">
                  <span className="shares__label">{shares.length} screens shared</span>
                  {shares.map((share) => (
                    <button
                      key={share.texorId}
                      type="button"
                      className={`shares__pick ${watching?.texorId === share.texorId ? 'shares__pick--on' : ''}`}
                      aria-pressed={watching?.texorId === share.texorId}
                      onClick={() => setWatchingId(share.texorId)}
                    >
                      {share.isYou ? 'Yours' : share.name}
                    </button>
                  ))}
                </div>
              ) : null}

              {stage.reason === 'pinned' ? (
                <button type="button" className="meet__unpin" onClick={() => setPinned(null)}>
                  <PinIcon /> Unpin
                </button>
              ) : null}
            </div>

            {/* Centred while they fit; left-aligned once the row must scroll. */}
            <div className={`meet__strip ${tileCount > 6 ? 'meet__strip--full' : ''}`}>
              {[selfTile, ...peerTiles]}
            </div>
          </div>
        )}

        {/**
          * Over the stage in every layout, not inside one of them.
          *
          * This lived inside the grid branch and was lost when the stage was
          * rewritten, so reactions were sent, broadcast and received — and then
          * drawn nowhere. They also never expired, because the cleanup runs on
          * the animation that was not happening.
          */}
        {settings.showReactions === false ? null : (
          <ReactionLayer
            reactions={reactions}
            onDone={(key) => setReactions((current) => current.filter((entry) => entry.key !== key))}
          />
        )}

        {/* Remote audio is played, never shown. One element per peer so one
            failing track cannot silence everybody else. */}
        {everyone.map((peer) => (
          <Fragment key={`${peer.texorId}-audio`}>
            {peer.tracks.mic
              ? <RemoteAudio track={peer.tracks.mic} speakerId={settings.speakerId} />
              : null}
            {/* Program audio from someone else's share. We never play back our
                own — the SFU does not send us our own producers — which is what
                stops a presenter hearing their content a round trip late. */}
            {peer.tracks.screenAudio
              ? <RemoteAudio track={peer.tracks.screenAudio} speakerId={settings.speakerId} />
              : null}
          </Fragment>
        ))}
      </main>

      {settingsTab ? (
        <SettingsDialog
          inCall
          onClose={() => {
            const saved = loadPreferences();
            setSettings(saved);
            // The dialog writes to localStorage; nothing else would tell the
            // player it had been turned off until the next call.
            chimes.current?.setEnabled(saved.sounds !== false);
            setSettingsTab(null);
          }}
        />
      ) : null}

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
          onSetRole={changeRole}
        />
      ) : null}

      <footer className="meet__bar">
        <div className="meet__bar-left">
          <Clock />
          <span className="meet__divider" aria-hidden="true" />
          <MeetingTimer
            activeMs={meeting?.activeMs}
            activeSince={meeting?.activeSince}
            maxDurationMinutes={meeting?.maxDurationMinutes}
          />
          <span className="meet__divider meet__divider--wide" aria-hidden="true" />
          <button
            type="button"
            className="meet__code"
            onClick={copyInvite}
            title="Copy the joining link"
            aria-label={`Meeting code ${meeting?.code}. Copy the joining link.`}
          >
            {meeting?.code}
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>

        <div className="meet__controls">
          {/* The caret is how people expect to reach device choice, rather
              than hunting for it in a menu while everyone waits. */}
          <div className="meet__combo">
            <ControlButton
              on={micOn}
              onClick={toggleMic}
              label={micOn ? 'Turn off microphone' : 'Turn on microphone'}
              icon={micOn ? <MicIcon /> : <MicOffIcon />}
            />
            <button
              type="button"
              className="meet__caret"
              aria-label="Audio settings"
              title="Audio settings"
              onClick={() => setSettingsTab('audio')}
            >
              <ChevronIcon />
            </button>
          </div>

          <div className="meet__combo">
            <ControlButton
              on={cameraOn}
              onClick={toggleCamera}
              label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
              icon={cameraOn ? <CameraIcon /> : <CameraOffIcon />}
            />
            <button
              type="button"
              className="meet__caret"
              aria-label="Video settings"
              title="Video settings"
              onClick={() => setSettingsTab('video')}
            >
              <ChevronIcon />
            </button>
          </div>
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

          <ControlButton
            on
            active={myHand}
            onClick={toggleHand}
            label={myHand ? 'Lower your hand' : 'Raise your hand'}
            icon={<HandIcon />}
          />

          {(grant.canShareScreen || isHost) && canCaptureScreen() ? (
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
          {/*
            * Host only, and in the bar rather than buried in settings, because
            * the moment anyone wants this is the moment somebody says the share
            * is stuttering — and it applies live, to everybody.
            */}
          {isHost && qualityOptions.length > 1 ? (
            <div className="meet__quality-wrap">
              {qualityOpen ? (
                <div className="meet__menu" role="menu">
                  <p className="meet__menu-head">
                    Video quality for everyone
                    <span>Higher costs more bandwidth for every person here.</span>
                  </p>
                  {qualityOptions.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={quality === tier.id}
                      className={`meet__menu-item ${quality === tier.id ? 'meet__menu-item--on' : ''}`}
                      onClick={async () => {
                        setQualityOpen(false);
                        if (tier.id === quality) return;
                        // Optimistic, then corrected by the broadcast the
                        // server sends back to everyone including us.
                        setQuality(tier.id);
                        try {
                          await roomRef.current?.setQuality(tier.id);
                        } catch (qualityError) {
                          setQuality(quality);
                          setError(qualityError.message);
                        }
                      }}
                    >
                      <strong>{tier.name}</strong>
                      <span>{tier.blurb}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <PanelButton
                active={qualityOpen}
                onClick={() => setQualityOpen((open) => !open)}
                label="Video quality"
                icon={<TuneIcon />}
              />
            </div>
          ) : null}

          <div className="meet__layout-wrap">
            {layoutOpen ? (
              <div className="meet__menu" role="menu">
                {[
                  ['auto', 'Automatic', 'Promotes whoever is presenting or talking'],
                  ['tiled', 'Tiled', 'Everyone the same size'],
                  ['spotlight', 'Spotlight', 'One person large, the rest in a strip'],
                ].map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={layout === value}
                    className={`meet__menu-item ${layout === value ? 'meet__menu-item--on' : ''}`}
                    onClick={() => { setLayout(value); setLayoutOpen(false); }}
                  >
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </button>
                ))}
                {pinned ? (
                  <button
                    type="button" role="menuitem" className="meet__menu-item"
                    onClick={() => { setPinned(null); setLayoutOpen(false); }}
                  >
                    <strong>Unpin</strong>
                    <span>Stop holding one person on the stage</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <PanelButton
              active={layoutOpen}
              onClick={() => setLayoutOpen((open) => !open)}
              label="Change layout"
              icon={<GridIcon />}
            />
          </div>

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
          {/*
            * Notes are for the person taking them, so this is never gated on a
            * meeting setting the way chat is — there is nobody else to protect
            * from a private note.
            */}
          <PanelButton
            active={panel === 'notes'}
            onClick={() => openPanel('notes')}
            label="Notes"
            icon={<NotesIcon />}
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

function SidePanel({ panel, onClose, meeting, user, role, isHost, peers, knocks, chat, room, onError, onDecide, onSetRole }) {
  const titles = {
    people: 'People', chat: 'In-call messages', info: 'Meeting details', notes: 'Notes',
  };

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
            room={room} onError={onError} onDecide={onDecide} onSetRole={onSetRole}
          />
        ) : null}
        {panel === 'chat' ? <ChatPanel chat={chat} room={room} user={user} /> : null}
        {panel === 'notes' ? (
          <MeetingNotes code={meeting.code} livePeople={peers} onError={onError} />
        ) : null}
        {panel === 'info' ? <InfoPanel meeting={meeting} room={room} /> : null}
      </div>
    </aside>
  );
}

function PeoplePanel({ user, role, isHost, peers, knocks, room, onError, onDecide, onSetRole }) {
  const [query, setQuery] = useState('');

  /**
   * Filtering, not searching.
   *
   * Everybody in the room is already on the client, so this is a match against
   * a list in memory — no request, and no empty pause while one is in flight.
   * It earns its place in a meeting of forty, which is exactly when scrolling
   * for one person stops working.
   */
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? peers.filter((peer) => (peer.name ?? '').toLowerCase().includes(needle))
    : peers;

  return (
    <>
      {peers.length > 3 ? (
        <label className="meet__search">
          <SearchIcon />
          <input
            className="meet__search-input"
            placeholder="Search people"
            aria-label="Search people in this meeting"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}

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
        <div className="row row--between" style={{ marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>In the call ({peers.length + 1})</h3>
          {isHost && peers.length > 0 ? (
            <button
              type="button"
              className="meet__chip"
              onClick={() => room.current?.muteEveryone().catch((e) => onError(e.message))}
            >
              Mute all
            </button>
          ) : null}
        </div>

        <div className="meet__person">
          <Avatar user={user} />
          <div className="grow">
            <strong>{user.displayName} (You)</strong>
            {role !== 'guest' ? <div className="meet__muted">{role}</div> : null}
          </div>
        </div>

        {shown.map((peer) => (
          <div className="meet__person" key={peer.texorId}>
            <Avatar user={{ displayName: peer.name, picture: peer.picture }} />
            <div className="grow">
              <strong>{peer.name}</strong>
              {peer.role === 'host' || peer.role === 'cohost' ? (
                <div className="meet__muted">{peer.role}</div>
              ) : null}
            </div>
            {peer.muted ? <span className="meet__muted-icon"><MicOffIcon /></span> : null}

            {isHost ? (
              <div className="meet__person-actions">
                {/* Muting is possible; unmuting somebody else is not, and the
                    button says so rather than sitting there doing nothing. */}
                <button
                  type="button"
                  className="meet__tool meet__tool--sm"
                  disabled={peer.muted}
                  aria-label={peer.muted ? `${peer.name} is already muted` : `Mute ${peer.name}`}
                  title={peer.muted ? 'Already muted — only they can unmute' : `Mute ${peer.name}`}
                  onClick={() => room.current?.muteParticipant(peer.texorId).catch((e) => onError(e.message))}
                >
                  <MicOffIcon />
                </button>

                {role === 'host' ? (
                  <button
                    type="button"
                    className="meet__tool meet__tool--sm"
                    aria-label={peer.role === 'cohost' ? `Remove co-host from ${peer.name}` : `Make ${peer.name} a co-host`}
                    title={peer.role === 'cohost' ? 'Remove co-host' : 'Make co-host'}
                    onClick={() => onSetRole(peer.texorId, peer.role === 'cohost' ? 'participant' : 'cohost')}
                  >
                    <ShieldIcon />
                  </button>
                ) : null}

                <button
                  type="button"
                  className="meet__tool meet__tool--sm meet__tool--danger"
                  aria-label={`Remove ${peer.name} from the meeting`}
                  title={`Remove ${peer.name}`}
                  onClick={() => room.current?.removePeer(peer.texorId).catch((e) => onError(e.message))}
                >
                  <RemovePersonIcon />
                </button>
              </div>
            ) : null}
          </div>
        ))}

        {/* A filter that matches nobody has to say so, or the panel simply
            looks broken. */}
        {needle && shown.length === 0 ? (
          <p className="meet__muted" style={{ padding: '0.5rem 0' }}>
            Nobody here matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : null}
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

function InfoPanel({ meeting, room }) {
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

      {/*
        * What the connection is actually doing. Here rather than behind a
        * developer flag, because the person who notices bad video is the one
        * who can say what their network is doing about it.
        */}
      <h3 style={{ marginTop: '1.5rem' }}>Connection</h3>
      <ConnectionInfo room={room} />
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

function RemoteAudio({ track, speakerId }) {
  const element = useRef(null);

  useEffect(() => {
    const audio = element.current;
    if (!audio || !track) return undefined;

    audio.srcObject = new MediaStream([track]);
    audio.play?.().catch(() => {});

    return () => { audio.srcObject = null; };
  }, [track]);

  /**
   * Which speakers this comes out of.
   *
   * Its own effect, so changing the output device does not tear down and
   * restart the stream — that would cut everybody off mid-sentence to apply a
   * setting.
   *
   * `setSinkId` is not everywhere: Firefox has it behind a flag and iOS has no
   * concept of choosing an output at all. Where it is missing the system
   * default is used, which is the behaviour every other product falls back to
   * as well. The picker offered this choice and nothing acted on it before.
   */
  useEffect(() => {
    const audio = element.current;
    if (!audio || typeof audio.setSinkId !== 'function') return;

    // '' is the documented way to ask for the system default.
    audio.setSinkId(speakerId ?? '').catch(() => {});
  }, [speakerId]);

  return <audio ref={element} autoPlay hidden />;
}

// ── Screens ──────────────────────────────────────────────────────────────────

/**
 * The green room.
 *
 * People arrive at a meeting already worried about whether their camera is on
 * and whether the right microphone is selected. Answering both before they are
 * in front of anyone is the entire point of this screen — so it previews the
 * real camera, lets the devices be chosen, and carries those choices into the
 * call rather than asking again once everyone can see them.
 */
function GreenRoomCard({ meeting, user, error, joining, onJoin, onBack }) {
  const video = useRef(null);
  const streamRef = useRef(null);

  /**
   * What this person chose last time.
   *
   * Read once, on the way in. The green room used to start every join from
   * hard-coded defaults — camera on, microphone on, system devices — so the
   * four settings that exist to answer this exact question ("join muted",
   * "join with camera off", which microphone, which camera) were collected in
   * Settings and never read by anything.
   */
  const saved = useMemo(() => joinDefaults(), []);

  const [micOn, setMicOn] = useState(saved.micOn);
  const [cameraOn, setCameraOn] = useState(saved.cameraOn);
  const [devices, setDevices] = useState({ mics: [], cameras: [] });
  const [chosen, setChosen] = useState(saved.chosen);
  const [deviceError, setDeviceError] = useState(null);

  /**
   * Remember a choice the moment it is made, rather than on the way through.
   *
   * Merged over a fresh read so this cannot clobber something changed in the
   * settings dialog while the green room was open — the two write to the same
   * store, and the last full object written would otherwise win.
   */
  const remember = useCallback((patch) => {
    savePreferences({ ...loadPreferences(), ...patch });
  }, []);

  // Preview the selected camera, and re-open it when the choice changes.
  useEffect(() => {
    let cancelled = false;

    async function open() {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (video.current) video.current.srcObject = null;

      try {
        /**
         * Audio is requested here even though nothing plays it back.
         *
         * Two reasons, and both were bugs. Asking for the camera alone meant
         * the microphone prompt appeared *after* joining — the worst moment for
         * it, and missing or dismissing it left someone in a meeting unable to
         * speak. And `enumerateDevices` only reveals ids and labels for kinds
         * you already have permission for, so the microphone picker was a list
         * of blank entries nobody could choose between.
         *
         * One prompt, before the call, covering both.
         */
        /**
         * Remembered devices are asked for exactly, then not at all.
         *
         * A stored id names a piece of hardware that may not be here any more
         * — a headset unplugged, a dock left at the office, a different laptop
         * with the same account. `exact` makes that an OverconstrainedError
         * that fails the whole request, taking the microphone down with the
         * camera. So the remembered choice is attempted, and a failure falls
         * back to whatever the system has rather than leaving somebody unable
         * to join at all. The stale id is forgotten on the way past, or the
         * same fallback would happen on every join from now on.
         */
        const exact = {
          audio: chosen.mic ? { deviceId: { exact: chosen.mic } } : true,
          video: cameraOn
            ? (chosen.camera ? { deviceId: { exact: chosen.camera } } : true)
            : false,
        };

        let stream;
        let fellBack = '';

        try {
          stream = await navigator.mediaDevices.getUserMedia(exact);
        } catch (error) {
          const named = Boolean(chosen.mic || chosen.camera);
          // Only a constraint failure is worth retrying. A refused permission
          // would fail again identically, and asking twice is worse than once.
          if (!named || error.name !== 'OverconstrainedError') throw error;

          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: cameraOn });

          if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }

          setChosen({ mic: '', camera: '' });
          remember(joinPatch({ chosen: { mic: '', camera: '' } }));
          fellBack = 'The device you used last time is not available, so the system default is selected.';
        }

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        // Only the picture is previewed. Playing our own microphone back would
        // be an echo, and a loud one on speakers.
        if (video.current) video.current.srcObject = stream;
        // Held until here: clearing unconditionally would wipe the note about
        // the missing device a moment after writing it.
        setDeviceError(fellBack || null);

        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices({
          mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
          cameras: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
        });
      } catch (error) {
        if (cancelled) return;
        setDeviceError(describeMediaError(error, cameraOn ? 'video' : 'audio'));

        // Losing the camera should not cost the microphone too: fall back to
        // audio alone so somebody can still join and be heard.
        if (cameraOn) {
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
            streamRef.current = audioOnly;
            setCameraOn(false);
          } catch {
            // Neither is available; the message above already says so.
          }
        }
      }
    }

    open();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOn, chosen.camera, chosen.mic]);

  const lobbyApplies =
    meeting &&
    !meeting.viewer.isHost &&
    (meeting.lobby === 'everyone' ||
      (meeting.lobby === 'external' && (meeting.viewer.isExternal || meeting.viewer.role === 'guest')));

  const isHost = meeting?.viewer?.isHost;
  const here = meeting?.participantCount ?? 0;

  return (
    <div className="gr">
      {/* ── what you are about to look like ── */}
      <div className="gr__stage">
        <div className="gr__preview">
          {cameraOn ? (
            <video ref={video} autoPlay playsInline muted className="gr__video" />
          ) : (
            /*
              * Your own face, not a crossed-out camera.
              *
              * This is the picture other people will see of you when your
              * camera is off, so showing it here is both a better-looking
              * empty state and an honest preview.
              */
            <div className="gr__off">
              {user?.picture
                ? <img src={user.picture} alt="" className="gr__off-face" />
                : (
                  <span className="gr__off-face gr__off-face--letter">
                    {(user?.displayName ?? '?').trim().charAt(0).toUpperCase()}
                  </span>
                )}
              <span className="gr__off-label">Your camera is off</span>
            </div>
          )}

          {/* Over the picture, where they are in the call itself. */}
          <div className="gr__controls">
            <button
              type="button"
              className={`gr__toggle ${micOn ? '' : 'gr__toggle--off'}`}
              aria-pressed={!micOn}
              aria-label={micOn ? 'Join with microphone off' : 'Join with microphone on'}
              onClick={() => {
                const next = !micOn;
                setMicOn(next);
                // Stored as "join muted", which is the question Settings asks.
                // Outside the updater: StrictMode may run one of those twice,
                // and an updater that writes to storage is not a pure function.
                remember(joinPatch({ micOn: next }));
              }}
            >
              {micOn ? <MicIcon /> : <MicOffIcon />}
            </button>
            <button
              type="button"
              className={`gr__toggle ${cameraOn ? '' : 'gr__toggle--off'}`}
              aria-pressed={!cameraOn}
              aria-label={cameraOn ? 'Join with camera off' : 'Join with camera on'}
              onClick={() => {
                const next = !cameraOn;
                setCameraOn(next);
                remember(joinPatch({ cameraOn: next }));
              }}
            >
              {cameraOn ? <CameraIcon /> : <CameraOffIcon />}
            </button>
          </div>
        </div>

        {/* Device choice under the picture it changes, not in a form below. */}
        {devices.mics.length > 1 || devices.cameras.length > 1 ? (
          <div className="gr__devices">
            {devices.mics.length > 1 ? (
              <label className="gr__device">
                <MicIcon />
                <select
                  aria-label="Microphone"
                  value={chosen.mic}
                  onChange={(event) => {
                    const mic = event.target.value;
                    setChosen((c) => ({ ...c, mic }));
                    remember(joinPatch({ chosen: { mic } }));
                  }}
                >
                  <option value="">Default microphone</option>
                  {devices.mics.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {devices.cameras.length > 1 ? (
              <label className="gr__device">
                <CameraIcon />
                <select
                  aria-label="Camera"
                  value={chosen.camera}
                  onChange={(event) => {
                    const camera = event.target.value;
                    setChosen((c) => ({ ...c, camera }));
                    remember(joinPatch({ chosen: { camera } }));
                  }}
                >
                  <option value="">Default camera</option>
                  {devices.cameras.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── what you are about to join ── */}
      <div className="gr__side">
        {/* What the room is, not what the record says: "in progress" over an
            empty room is the same lie the meetings list used to tell. */}
        <span className={`gr__state ${(meeting?.presentCount ?? 0) > 0 ? 'gr__state--live' : ''}`}>
          {(meeting?.presentCount ?? 0) > 0 ? 'In progress' : 'Ready when you are'}
        </span>

        <h1 className="gr__title">{meeting?.title}</h1>

        <p className="gr__host">
          Hosted by {meeting?.host?.name}
          <span className="gr__sep" aria-hidden="true">·</span>
          {here > 0 ? `${here} already here` : 'nobody here yet'}
        </p>

        {meeting?.agenda ? <p className="gr__agenda">{meeting.agenda}</p> : null}

        <Alert kind="error">{error ?? deviceError}</Alert>
        {lobbyApplies ? (
          <Alert kind="info">You will wait in the lobby until a host lets you in.</Alert>
        ) : null}

        <div className="gr__you">
          <Avatar user={user} />
          <div>
            <strong>{user.displayName}</strong>
            <span>Joining as your Texor Account</span>
          </div>
        </div>

        <div className="gr__go">
          <Button
            onClick={() => {
              // Hand the preview back before the call re-opens the same devices.
              streamRef.current?.getTracks().forEach((track) => track.stop());
              streamRef.current = null;
              onJoin({ micOn, cameraOn, devices: chosen });
            }}
            loading={joining}
          >
            {/* "Start" when the room is empty, whoever you are — anyone can
                open it now, and a host walking into a busy room is joining it
                like everybody else. */}
            {(meeting?.presentCount ?? 0) > 0 ? 'Join now' : 'Start the meeting'}
          </Button>
          <button
            type="button"
            className="gr__back"
            onClick={onBack}
            aria-label="Back to meetings"
            title="Back to meetings"
          >
            <ChevronIcon />
          </button>
        </div>
      </div>
    </div>
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
        {/*
          * "Meeting ended" is no longer the ordinary case, so it is no longer
          * the default heading. A room that emptied out is not over — its link
          * still opens it — and this screen is now only reached by a meeting
          * that was cancelled, a code that resolves to nothing, a refusal, or
          * somebody else closing the room while you were in it.
          */}
        <h1>{missing ? 'This meeting no longer exists' : error ? 'Cannot join' : 'You left the meeting'}</h1>
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
          <Alert kind={error ? 'error' : 'info'}>
            {error ?? notice ?? 'You are no longer in this meeting.'}
          </Alert>
          <div className="row" style={{ gap: '0.6rem' }}>
            {/* The room can be opened again, so offer that rather than only
                the way out. */}
            <Button onClick={() => window.location.reload()}>Rejoin</Button>
            <Button variant="secondary" onClick={onBack}>Back to meetings</Button>
          </div>
        </>
      )}
    </>
  );
}
