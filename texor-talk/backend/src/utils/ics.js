/**
 * iCalendar (RFC 5545) generation.
 *
 * Hand-written rather than pulled from a package, because the subset a meeting
 * invite needs is small and the two rules that actually break calendars — CRLF
 * line endings and folding at 75 octets — are three lines of code.
 *
 * Every timestamp goes out in UTC with a `Z`. The alternative is shipping a
 * VTIMEZONE block with the full daylight-saving history of the host's zone,
 * which is a great deal of work to arrive at the same instant in time. The
 * meeting's own timezone is still carried in `X-TEXOR-TIMEZONE` for anything
 * that wants to display it.
 */

/** Text values escape backslash, semicolon, comma and newline. In that order. */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** 20260914T093000Z */
const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Folds a content line to 75 octets.
 *
 * Counted in UTF-8 bytes, not characters, and never split inside a multi-byte
 * character — an invite with a name in it should survive being folded.
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let offset = 0;
  let limit = 75;

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Walk back off a continuation byte so a character is never cut in half.
    while (end > offset && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;

    parts.push(bytes.subarray(offset, end).toString('utf8'));
    offset = end;
    // Continuation lines start with a space, which costs one of the 75.
    limit = 74;
  }

  return parts.join('\r\n ');
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The meeting's recurrence as an RRULE, or null when it does not repeat. */
export function toRRule(recurrence, start) {
  const { freq, interval = 1, count, until } = recurrence ?? {};
  if (!freq || freq === 'none') return null;

  const parts = [];

  if (freq === 'weekdays') {
    parts.push('FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR');
  } else {
    parts.push(`FREQ=${freq.toUpperCase()}`);
    if (interval > 1) parts.push(`INTERVAL=${interval}`);
    // Without BYDAY a weekly rule is only implicitly anchored to the start;
    // saying it outright is what stops clients from disagreeing about the day.
    if (freq === 'weekly') parts.push(`BYDAY=${DAY_CODES[new Date(start).getUTCDay()]}`);
  }

  if (count) parts.push(`COUNT=${count}`);
  else if (until) parts.push(`UNTIL=${stamp(until)}`);

  return parts.join(';');
}

/**
 * One VEVENT, wrapped in a VCALENDAR, ready to serve as `text/calendar`.
 *
 * `METHOD:REQUEST` with a stable `UID` is what makes this an invitation rather
 * than a copy: send it again after moving the meeting, with `SEQUENCE` bumped,
 * and calendars update the existing entry instead of adding a second one.
 */
export function meetingInvite({ meeting, joinUrl, organizer, sequence = 0, method = 'REQUEST' }) {
  const start = meeting.scheduledStart ?? new Date();
  const end = meeting.scheduledEnd ?? new Date(new Date(start).getTime() + 60 * 60 * 1000);

  const description = [
    meeting.agenda,
    meeting.agenda ? '' : null,
    'Join the meeting:',
    joinUrl,
    '',
    `Meeting code: ${meeting.code}`,
  ]
    .filter((line) => line !== null)
    .join('\n')
    .trim();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Texor//Texor Talk//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${meeting.code}@talk.texor.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeText(meeting.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(joinUrl)}`,
    `URL:${escapeText(joinUrl)}`,
    `STATUS:${meeting.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    `X-TEXOR-TIMEZONE:${escapeText(meeting.timezone ?? 'UTC')}`,
  ];

  const rrule = toRRule(meeting.recurrence, start);
  if (rrule) lines.push(`RRULE:${rrule}`);

  if (organizer?.email) {
    lines.push(
      `ORGANIZER;CN=${escapeText(organizer.name || organizer.email)}:mailto:${organizer.email}`,
    );
  }

  for (const invitee of meeting.invitees ?? []) {
    const partstat = {
      accepted: 'ACCEPTED',
      declined: 'DECLINED',
      tentative: 'TENTATIVE',
    }[invitee.response] ?? 'NEEDS-ACTION';

    lines.push(
      `ATTENDEE;CN=${escapeText(invitee.name || invitee.email)};ROLE=${
        invitee.role === 'cohost' ? 'CHAIR' : 'REQ-PARTICIPANT'
      };PARTSTAT=${partstat};RSVP=TRUE:mailto:${invitee.email}`,
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // CRLF throughout, and a trailing one — some clients reject a file without it.
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export default { meetingInvite, toRRule };
