'use client';

/**
 * Per-browser preferences: which devices to use, and how to join.
 *
 * `localStorage`, deliberately. These describe *this machine* — which of its
 * microphones, which of its cameras — so syncing them to an account would push
 * a laptop's webcam choice onto somebody's phone. They never leave the browser.
 *
 * Every read is defensive: storage throws in private windows and in embedded
 * browsers, and returns strings written by an older version of this file.
 * Nothing here is important enough to be worth an exception.
 */

const KEY = 'talk.preferences.v1';

export const DEFAULT_PREFERENCES = {
  micId: null,
  cameraId: null,
  speakerId: null,
  noiseSuppression: true,
  joinMuted: false,
  joinCameraOff: false,
  mirror: true,
  leaveEmpty: true,
  showReactions: true,
  // Short chimes when somebody joins or leaves, and when the meeting ends.
  sounds: true,
  // Whether a shared screen sacrifices sharpness or frames under pressure.
  screenOptimise: 'motion',
};

export function loadPreferences() {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFERENCES };

  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    // Spread over the defaults rather than trusting the shape: a key added in a
    // later version must not come back undefined for somebody upgrading.
    return { ...DEFAULT_PREFERENCES, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Private windows and blocked storage. The settings simply do not persist,
    // which is a much better outcome than the dialog failing to close.
  }
  return preferences;
}

/**
 * How a stored preference becomes the state the green room opens with.
 *
 * Pure, and separate from the component, because this is the whole of what
 * "remember my choice" means and it was the part that did not exist: the green
 * room opened with hard-coded defaults, so "join muted", "join with camera
 * off" and the two device pickers were collected by Settings and read by
 * nothing.
 *
 * Note the inversion. Settings asks whether to *join muted*; the control in
 * the green room is whether the microphone is *on*. Storing one and rendering
 * the other is exactly where a round trip gets flipped, so both directions
 * live here next to each other.
 */
export function joinDefaults(preferences = loadPreferences()) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(preferences ?? {}) };

  return {
    micOn: !prefs.joinMuted,
    cameraOn: !prefs.joinCameraOff,
    // '' rather than null: these feed a `<select>`, and a null value makes it
    // an uncontrolled component that React then complains about.
    chosen: { mic: prefs.micId ?? '', camera: prefs.cameraId ?? '' },
  };
}

/** The other direction: what to store when somebody changes those controls. */
export function joinPatch({ micOn, cameraOn, chosen } = {}) {
  const patch = {};

  if (micOn !== undefined) patch.joinMuted = !micOn;
  if (cameraOn !== undefined) patch.joinCameraOff = !cameraOn;

  if (chosen) {
    // Empty means "system default", which is stored as absence rather than as
    // an empty string — otherwise it is indistinguishable from a device whose
    // id happens to be missing.
    if (chosen.mic !== undefined) patch.micId = chosen.mic || null;
    if (chosen.camera !== undefined) patch.cameraId = chosen.camera || null;
  }

  return patch;
}

export default {
  loadPreferences, savePreferences, joinDefaults, joinPatch, DEFAULT_PREFERENCES,
};
