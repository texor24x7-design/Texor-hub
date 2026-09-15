/**
 * How long a meeting has been running, and how long it has left.
 *
 * Pure, so the rules can be checked without a clock to wait on. Everything
 * takes `now` rather than reading it, which is the only way to test "two
 * minutes before the limit" without sitting through a meeting.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Elapsed time, as a running clock.
 *
 * `M:SS` under an hour and `H:MM:SS` over it — the same shape every stopwatch
 * uses, so nobody has to work out whether `1:05` means an hour or a minute.
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Time left, in words rather than digits.
 *
 * A countdown ticking down second by second in the corner of a call is a
 * pressure device. This is only shown when the end is close enough to matter,
 * and it is rounded, because "9 min left" is what somebody needs to decide
 * whether to start a new topic.
 */
export function formatRemaining(ms) {
  if (ms <= 0) return 'Time is up';
  if (ms < MINUTE) return 'Under a minute left';

  const minutes = Math.round(ms / MINUTE);
  return `${minutes} min left`;
}

/** When the warning starts, and when it gets insistent. */
export const SOON_MS = 10 * MINUTE;
export const URGENT_MS = 2 * MINUTE;

/**
 * Everything the call bar needs to render the timer.
 *
 * A meeting with no limit gets an elapsed clock and nothing else — there is
 * nothing to warn about, and an ever-present countdown would invent an anxiety
 * the meeting did not have.
 */
export function meetingTime({ startedAt, maxDurationMinutes = 0, now = Date.now() } = {}) {
  const idle = {
    running: false,
    elapsedMs: 0,
    elapsed: '',
    remainingMs: null,
    remaining: null,
    level: 'normal',
  };

  if (!startedAt) return idle;

  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return idle;

  // A clock skewed a few seconds ahead of the server should read 0:00, not a
  // negative number counting up towards zero.
  const elapsedMs = Math.max(0, now - started);

  const limitMs = maxDurationMinutes > 0 ? maxDurationMinutes * MINUTE : null;
  const remainingMs = limitMs === null ? null : Math.max(0, limitMs - elapsedMs);

  let level = 'normal';
  if (remainingMs !== null) {
    if (remainingMs <= 0) level = 'over';
    else if (remainingMs <= URGENT_MS) level = 'urgent';
    else if (remainingMs <= SOON_MS) level = 'soon';
  }

  return {
    running: true,
    elapsedMs,
    elapsed: formatDuration(elapsedMs),
    remainingMs,
    // Silent until it is worth saying.
    remaining: level === 'normal' ? null : formatRemaining(remainingMs),
    level,
  };
}

/**
 * "Started 12 min ago" — for a list, where a ticking clock would be noise.
 *
 * Deliberately coarse. A meeting list is read at a glance and refreshed rarely,
 * so a number precise to the second would just be wrong most of the time.
 */
export function startedAgo(startedAt, now = Date.now()) {
  if (!startedAt) return '';

  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return '';

  const ms = Math.max(0, now - started);
  if (ms < MINUTE) return 'just started';

  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${minutes} min in`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h in` : `${hours}h ${rest}m in`;
}

/**
 * How long something lasted — a meeting, or one person's time in it.
 *
 * An open-ended span (no `to`) is measured to now, which is what makes the same
 * function serve "ran for 45:12" and "has been here 12:04".
 */
export function durationBetween(from, to, now = Date.now()) {
  if (!from) return '';

  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return '';

  const end = to ? new Date(to).getTime() : now;
  if (!Number.isFinite(end)) return '';

  return formatDuration(Math.max(0, end - start));
}

export default {
  formatDuration, formatRemaining, meetingTime, startedAgo, durationBetween, SOON_MS, URGENT_MS,
};
