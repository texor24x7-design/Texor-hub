/**
 * Who may come into a meeting, and whether they knock first.
 *
 * One function, because this question used to be answered in slightly different
 * ways in different places — the REST join, the media socket, the admitted
 * knock, and the greenroom's own guess in the browser — and every difference
 * between them was a way in. Everything that decides admission asks this.
 *
 * It is pure: the meeting, the person, the policy in; a decision out. Time
 * windows, capacity and the duration limit stay in `evaluateJoin`, because
 * they are about *when* and *how many*, not about *who*.
 *
 * The rules, in the order they apply:
 *
 *   refuse   the meeting was cancelled
 *   refuse   the person was removed from it
 *   refuse   an outsider, where the organisation or the meeting forbids them
 *   refuse   "only people I invite" and this person was not invited
 *   refuse   a guest with no Texor Account, unless the meeting is open to anyone
 *   admit    the host, a co-host, or whoever is standing in for the host
 *   admit    somebody already let in during this sitting
 *   knock    "everyone knocks"
 *   knock    "people outside your organisation knock", and they are outside it
 *   admit    everyone else
 *
 * "This sitting" is what keeps the waiting room meaning what it says. A pass
 * lasts until the room empties or the meeting ends — see `markLeft` and
 * `endMeeting` — so a dropped connection rejoins without knocking, and nobody
 * carries a pass from last week's meeting into this one.
 */
import { effectiveLobby, isExternalEmail as defaultIsExternalEmail } from './policy.service.js';

export const OUTCOMES = Object.freeze({ ADMIT: 'admit', KNOCK: 'knock', REFUSE: 'refuse' });

const refuse = (code, reason, extra = {}) => ({ outcome: OUTCOMES.REFUSE, code, reason, ...extra });

/**
 * @param meeting  a Meeting document (its methods are used)
 * @param user     `{ texorId, email, isGuest }`
 * @param policy   the organisation's policy document
 * @param isExternalEmail  injectable, so the rule can be checked without an environment
 */
export function admissionFor({ meeting, user, policy, isExternalEmail = defaultIsExternalEmail }) {
  if (meeting.status === 'cancelled') {
    return refuse('meeting_cancelled', 'This meeting was cancelled.', { status: 410 });
  }

  if (meeting.isRemoved(user.texorId)) {
    return refuse('forbidden', 'You were removed from this meeting.');
  }

  const role = meeting.roleOf(user.texorId, user.email);
  const isHost = role === 'host' || role === 'cohost';

  // A guest has no email and therefore no domain to match; they are outside the
  // organisation by definition, and must not fall through to "nobody is
  // outside" when ORG_EMAIL_DOMAINS is unset.
  const isExternal = Boolean(user.isGuest) || isExternalEmail(user.email);

  const base = { role, isHost, isExternal };

  if (isExternal && !(policy.allowExternalGuests && meeting.settings?.allowExternalGuests !== false)) {
    return refuse('forbidden', 'This meeting is not open to guests from outside the organisation.', base);
  }

  if (meeting.access === 'invited' && role === 'guest') {
    return refuse('forbidden', 'This meeting is for invited people only.', base);
  }

  /**
   * A guest pass is checked against the meeting as it is *now*.
   *
   * It used to be checked once, when the pass was issued. A host who opened a
   * meeting to anyone with the code and then closed it to Texor Accounts found
   * every pass already handed out still worked for the rest of its twelve hours.
   */
  if (user.isGuest && meeting.access !== 'anyone') {
    return refuse('forbidden', 'This meeting needs a Texor Account to join.', base);
  }

  if (isHost) return { outcome: OUTCOMES.ADMIT, ...base, lobby: meeting.lobby, why: 'host' };

  if (meeting.hasBeenAdmitted(user.texorId)) {
    return { outcome: OUTCOMES.ADMIT, ...base, lobby: meeting.lobby, why: 'admitted-this-sitting' };
  }

  // Can only tighten: an organisation that holds outsiders at the door holds
  // them there even when the host turned the waiting room off.
  const lobby = effectiveLobby(meeting, policy, { isExternal });

  if (lobby === 'everyone') {
    return { outcome: OUTCOMES.KNOCK, ...base, lobby, why: 'everyone-knocks' };
  }

  /**
   * "People outside your organisation knock" means exactly that.
   *
   * It used to hold every uninvited colleague too, because `roleOf` calls anyone
   * not on the invite list a 'guest' — so a label about outsiders quietly meant
   * "anyone you did not invite", and a host who wanted that had no way to see it.
   */
  if (lobby === 'external' && isExternal) {
    return { outcome: OUTCOMES.KNOCK, ...base, lobby, why: 'outside-knocks' };
  }

  return { outcome: OUTCOMES.ADMIT, ...base, lobby, why: 'walks-in' };
}

/** Whether a waiting room is stricter than another. Tightening cancels this sitting's passes. */
const STRICTNESS = { off: 0, external: 1, everyone: 2 };
export const isStricterLobby = (next, previous) => (STRICTNESS[next] ?? 0) > (STRICTNESS[previous] ?? 0);

const OPENNESS = { invited: 0, texor: 1, anyone: 2 };
export const isNarrowerAccess = (next, previous) => (OPENNESS[next] ?? 0) < (OPENNESS[previous] ?? 0);

export default { admissionFor, isStricterLobby, isNarrowerAccess, OUTCOMES };
