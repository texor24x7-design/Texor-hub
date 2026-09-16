'use client';

/**
 * The floating window that keeps a meeting visible after you switch away.
 *
 * ── Why this is two mechanisms and not one ──
 *
 * There are two picture-in-picture APIs and they are not alternatives so much
 * as different ceilings:
 *
 *   · **Document PiP** (`documentPictureInPicture`) opens a real window with a
 *     real document in it, so a whole interface can go inside — tiles, names,
 *     a mute button, a way to hang up. This is what the feature is actually
 *     for, and it is Chromium-only today.
 *   · **Video PiP** (`video.requestPictureInPicture()`) is everywhere else and
 *     can show exactly one `<video>` and nothing else. No controls, no names,
 *     no second participant.
 *
 * So Document PiP is used where it exists and video PiP is the floor, rather
 * than picking the lowest common denominator and shipping a feature that is
 * worse for everybody.
 *
 * ── Why it can open by itself ──
 *
 * Opening a window normally needs a click, which is useless here: the whole
 * point is to appear when somebody *leaves*. The way out is
 * `mediaSession.setActionHandler('enterpictureinpicture')` — the browser
 * offers a call that is already capturing media the right to do this, and
 * calls the handler itself when the user switches away. Nothing is forced:
 * a browser that does not grant it simply never calls us, and the manual
 * button still works.
 */

/* ── what the window shows ────────────────────────────────────────────────── */

/**
 * The one thing worth looking at in a window the size of a playing card.
 *
 * Ordered by how likely it is to be the reason somebody looked:
 *
 *   1. a shared screen — somebody is showing something on purpose
 *   2. whoever is talking
 *   3. anybody else who is here
 *   4. failing all that, yourself, so the window is never blank
 *
 * Pure, and separate from every browser API in this file, because this is the
 * part with judgement in it and the part worth testing.
 */
export function choosePipFeed({
  shares = [],
  peers = [],
  speakingTexorId = null,
  self = null,
} = {}) {
  const share = shares.find((entry) => entry?.track) ?? null;
  if (share) {
    return { kind: 'screen', track: share.track, name: share.name, texorId: share.texorId };
  }

  const speaker = peers.find((peer) => peer?.texorId === speakingTexorId && peer?.tracks?.camera);
  if (speaker) {
    return { kind: 'peer', track: speaker.tracks.camera, name: speaker.name, texorId: speaker.texorId };
  }

  const anyone = peers.find((peer) => peer?.tracks?.camera);
  if (anyone) {
    return { kind: 'peer', track: anyone.tracks.camera, name: anyone.name, texorId: anyone.texorId };
  }

  // A peer with no camera still beats nothing: the window carries their name
  // and the fact that somebody is there.
  const present = peers[0];
  if (present) {
    return { kind: 'peer', track: null, name: present.name, texorId: present.texorId };
  }

  if (self) return { kind: 'self', track: self.track ?? null, name: self.name, texorId: self.texorId };

  return { kind: 'empty', track: null, name: '', texorId: null };
}

/* ── capability ───────────────────────────────────────────────────────────── */

export const documentPipSupported = () =>
  typeof window !== 'undefined' && 'documentPictureInPicture' in window;

export const videoPipSupported = () =>
  typeof document !== 'undefined'
  && document.pictureInPictureEnabled === true
  && !document.pictureInPictureElement;

export const pipSupported = () => documentPipSupported() || videoPipSupported();

/* ── the window ───────────────────────────────────────────────────────────── */

/**
 * Give the floating window the page's styles.
 *
 * A Document PiP window is a separate document: it inherits no CSS at all, so
 * without this the interface arrives as unstyled text. Same-origin sheets are
 * copied rule by rule; anything that throws on `cssRules` is a sheet the
 * browser will not let us read, and is re-linked by URL instead.
 */
export function copyStyles(target) {
  if (!target?.document) return;

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const text = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
      const style = target.document.createElement('style');
      style.textContent = text;
      target.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = target.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.document.head.appendChild(link);
    }
  }
}

/**
 * Open the floating window.
 *
 * Resolves to `null` rather than throwing when the browser refuses — which it
 * does for reasons that are not faults: no permission yet, already open, or a
 * request that arrived without the activation it wanted. A refusal here should
 * leave the meeting exactly as it was.
 */
export async function openPipWindow({ width = 400, height = 300 } = {}) {
  if (!documentPipSupported()) return null;

  try {
    const target = await window.documentPictureInPicture.requestWindow({
      width,
      height,
      // Keep it out of the tab strip's way where the browser offers that.
      disallowReturnToOpener: false,
    });

    copyStyles(target);
    target.document.documentElement.classList.add('pip');
    return target;
  } catch {
    return null;
  }
}

/**
 * Ask the browser to call us when the user switches away.
 *
 * Returns a function that takes the registration back off again — important,
 * because a handler left behind after a call ends would try to open a window
 * for a meeting that no longer exists.
 */
export function onBrowserRequestsPip(handler) {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  if (!session?.setActionHandler) return () => {};

  try {
    session.setActionHandler('enterpictureinpicture', handler);
  } catch {
    // Not every browser knows this action; the manual button still works.
    return () => {};
  }

  return () => {
    try { session.setActionHandler('enterpictureinpicture', null); } catch { /* going away anyway */ }
  };
}

/**
 * Make the page look like something that is playing, because that is what the
 * browser grants automatic picture-in-picture to.
 *
 * Registering the `enterpictureinpicture` action is necessary and on its own
 * not sufficient. Chrome hands out the automatic version to a page with a
 * *live media session* — one with metadata and a playback state — and quietly
 * declines for a page that merely asked. Nothing here forces anything: a
 * browser with a different policy ignores all of it.
 *
 * Returns a function that puts the session back, so a session does not outlive
 * the call and leave a phantom in the operating system's media controls.
 */
export function holdMediaSession({ title = 'Meeting', artist = 'Texor Talk' } = {}) {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  if (!session) return () => {};

  const previous = { metadata: session.metadata, playbackState: session.playbackState };

  try {
    if (typeof window !== 'undefined' && window.MediaMetadata) {
      session.metadata = new window.MediaMetadata({ title, artist });
    }
    session.playbackState = 'playing';
  } catch {
    // An engine that does not know these; the manual button still works.
  }

  return () => {
    try {
      session.metadata = previous.metadata;
      session.playbackState = previous.playbackState ?? 'none';
    } catch { /* going away anyway */ }
  };
}

export default {
  choosePipFeed,
  pipSupported,
  documentPipSupported,
  videoPipSupported,
  openPipWindow,
  copyStyles,
  onBrowserRequestsPip,
  holdMediaSession,
};
