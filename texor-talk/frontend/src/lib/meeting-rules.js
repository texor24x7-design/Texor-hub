/**
 * What the two door settings mean, in one place.
 *
 * "Who can join" and the waiting room were worded four times — the start
 * dialog, the schedule form, the meeting's settings and the admin console —
 * and the four disagreed. Worse, some of the wording described rules the server
 * does not follow: "guests from outside knock" also held colleagues, and
 * "everyone knocks" did not hold anybody who had ever been in the meeting
 * before. The server rules are in `backend/src/services/admission.service.js`;
 * these are the same rules in the words a host reads.
 */

export const ACCESS_OPTIONS = [
  { value: 'texor', label: 'Anyone with a Texor Account' },
  { value: 'invited', label: 'Only people I invite' },
  { value: 'anyone', label: 'Anyone with the code, including guests without an account' },
];

export const LOBBY_OPTIONS = [
  { value: 'off', label: 'Off — anyone allowed in walks straight into the call' },
  { value: 'external', label: 'People outside your organisation knock' },
  { value: 'everyone', label: 'Everyone knocks, except you and your co-hosts' },
];

export const labelFor = (options, value) => options.find((option) => option.value === value)?.label ?? '';

/**
 * What else the host should know about the choice in front of them.
 *
 * `org` is what `GET /api/meetings/defaults` answers, or the policy block on a
 * meeting. Undefined until it arrives, and every hint here copes with that.
 */
export function lobbyHint(lobby, org) {
  if (lobby === 'off' && org?.forceLobbyForExternal) {
    return 'Your organisation holds people from outside it in the waiting room even when this is off. Everyone else walks in.';
  }

  if (lobby === 'external' && org && !org.orgDomainsConfigured) {
    return 'No organisation email domains are set yet, so nobody with a Texor Account counts as outside — only guests without an account will knock. An admin sets the domains under Admin → Meetings.';
  }

  if (lobby === 'everyone') {
    return 'Everybody waits until you let them in, invited or not. People already in the call stay in it.';
  }

  return 'You and your co-hosts never wait. Anyone standing in for you while you are away does not either.';
}

export function accessHint(access, org) {
  if (access === 'anyone' && org && !org.allowExternalGuests) {
    return 'Your organisation does not allow guests without a Texor Account, so they will be turned away at the door.';
  }

  if (access === 'invited') {
    return 'Only the people on the invite list, and your co-hosts. Anyone else is turned away rather than held in the waiting room.';
  }

  return undefined;
}

/** "Off — anyone allowed in walks straight into the call (your organisation's default)" */
export function lobbyOptionsFor(org) {
  return LOBBY_OPTIONS.map((option) => (
    org?.lobby === option.value
      ? { ...option, label: `${option.label} — your organisation's default` }
      : option
  ));
}

export default { ACCESS_OPTIONS, LOBBY_OPTIONS, lobbyOptionsFor, lobbyHint, accessHint, labelFor };
