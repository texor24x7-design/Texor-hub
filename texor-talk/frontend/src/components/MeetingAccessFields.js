'use client';

import { Field } from '@/components/ui';
import { ACCESS_OPTIONS, accessHint, lobbyHint, lobbyOptionsFor } from '@/lib/meeting-rules';

/**
 * The two questions at a meeting's door: who can join, and who knocks.
 *
 * One component for the three places they are asked — starting a meeting,
 * scheduling one, and changing one afterwards — because three copies is how the
 * same option came to be worded three ways, and how the schedule form ended up
 * without the warnings the other two had.
 *
 * `org` is the organisation's rules from `GET /api/meetings/defaults`, or the
 * `policy` block on a meeting. Until it arrives the waiting room is disabled:
 * the field would otherwise show a value the host has not chosen and cannot
 * yet be told the truth about.
 */
export function MeetingAccessFields({ access, lobby, org, onChange, idPrefix = 'meeting' }) {
  const lobbyOptions = lobbyOptionsFor(org);

  return (
    <>
      <Field label="Who can join" hint={accessHint(access, org)} htmlFor={`${idPrefix}-access`}>
        <select
          id={`${idPrefix}-access`}
          className="input"
          value={access}
          onChange={(event) => onChange({ access: event.target.value })}
        >
          {ACCESS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Waiting room" hint={lobbyHint(lobby, org)} htmlFor={`${idPrefix}-lobby`}>
        <select
          id={`${idPrefix}-lobby`}
          className="input"
          value={lobby}
          disabled={!org}
          onChange={(event) => onChange({ lobby: event.target.value })}
        >
          {org ? null : <option value="">Checking your organisation&rsquo;s rules…</option>}
          {lobbyOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

export default MeetingAccessFields;
