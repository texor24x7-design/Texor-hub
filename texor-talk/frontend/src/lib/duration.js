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
export function meetingTime({
  activeMs = 0,
  activeSince = null,
  maxDurationMinutes = 0,
  now = Date.now(),
} = {}) {
  const idle = {
    running: false,
    elapsedMs: 0,
    elapsed: '',
    remainingMs: null,
    remaining: null,
    level: 'normal',
  };

  /**
   * Occupied time, not time since the meeting started.
   *
   * `activeMs` is what earlier stretches banked; `activeSince` is the one
   * running, and is null exactly when the room is empty. Counting from
   * `startedAt` instead meant an empty room kept ticking all afternoon, and a
   * reopened one carried on from the original start rather than from where it
   * had actually got to.
   */
  const banked = Number(activeMs);
  if (!Number.isFinite(banked) || banked < 0) return idle;

  const since = activeSince === null || activeSince === undefined
    ? null
    : new Date(activeSince).getTime();

  if (since !== null && !Number.isFinite(since)) return idle;

  // Nothing banked and nobody here: the meeting has not run at all yet, which
  // is a different thing from having run for zero seconds.
  if (banked === 0 && since === null) return idle;

  // A clock skewed a few seconds ahead of the server should read 0:00, not a
  // negative number counting up towards zero.
  const elapsedMs = banked + (since === null ? 0 : Math.max(0, now - since));

  const limitMs = maxDurationMinutes > 0 ? maxDurationMinutes * MINUTE : null;
  const remainingMs = limitMs === null ? null : Math.max(0, limitMs - elapsedMs);

  let level = 'normal';
  if (remainingMs !== null) {
    if (remainingMs <= 0) level = 'over';
    else if (remainingMs <= URGENT_MS) level = 'urgent';
    else if (remainingMs <= SOON_MS) level = 'soon';
  }

  return {
    // Running means somebody is in the room. An empty one holds its total
    // rather than counting, which is the whole point of the change.
    running: since !== null,
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

/**
 * "Good morning" and friends.
 *
 * The boundaries are the ordinary English ones rather than anything clever:
 * morning until noon, afternoon until five, evening after that. Takes a date so
 * it can be tested at three in the afternoon without waiting for three in the
 * afternoon.
 */
export function greetingFor(at = new Date()) {
  const hour = at instanceof Date ? at.getHours() : new Date(at).getHours();
  if (!Number.isFinite(hour)) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A meeting's time, as two lines.
 *
 * A list reads down its left edge, so the time wants weight and a shape that
 * repeats: something large and something small, every row the same. One long
 * string like "Wed 16 Sept, 10:30" gives a row nothing to align to and nothing
 * to scan.
 */
export function whenParts(start, now = new Date()) {
  if (!start) return { primary: '—', secondary: 'No time set' };

  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return { primary: '—', secondary: 'No time set' };

  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / (24 * 60 * MINUTE));

  if (days === 0) return { primary: time, secondary: 'Today' };
  if (days === 1) return { primary: time, secondary: 'Tomorrow' };
  if (days === -1) return { primary: time, secondary: 'Yesterday' };

  // Within the week ahead a weekday is easier to place than a date.
  const secondary = days > 1 && days < 7
    ? at.toLocaleDateString(undefined, { weekday: 'long' })
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return { primary: time, secondary };
}

export default {
  formatDuration, formatRemaining, meetingTime, startedAgo, durationBetween, greetingFor,
  whenParts, SOON_MS, URGENT_MS,
};
