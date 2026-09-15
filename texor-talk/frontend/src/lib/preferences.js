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

export default { loadPreferences, savePreferences, DEFAULT_PREFERENCES };
