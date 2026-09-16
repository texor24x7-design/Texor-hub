'use client';

import { useState } from 'react';
import { meetings as meetingApi } from '@/lib/api';
import { startedAgo } from '@/lib/duration';

/**
 * A meeting happening right now, on the meetings list.
 *
 * Two controls rather than one: joining, and — for the host — ending it without
 * having to join first. A host who notices a meeting still open after everyone
 * wandered off should not have to walk back into the room to close the door.
 *
 * The card is a container, not a `<button>`, which it used to be. A button
 * inside a button is invalid markup and the two click targets fight over every
 * press, so the clickable area is its own element beside the End control.
 */
export function LiveCard({ meeting, onOpen, onEnded, onError }) {
  const [ending, setEnding] = useState(false);

  // Who is connected, not who has an open attendance row — the same number the
  // card's "live" state is decided by.
  const inCall = meeting.presentCount ?? meeting.participantCount ?? 0;

  async function end() {
    /**
     * Closing the room, not destroying it.
     *
     * This used to warn that it could not be undone, which is no longer true:
     * the link still works afterwards and anybody with access reopens the room
     * by walking into it. What is worth confirming is the part that is real and
     * immediate — that people in the call right now get disconnected — so the
     * count is what the question is about.
     */
    const warning = inCall > 0
      ? `Close "${meeting.title}"? ${inCall} ${inCall === 1 ? 'person is' : 'people are'} still in the call. `
        + 'The link keeps working and anyone can reopen it.'
      : `Close "${meeting.title}"? The link keeps working and anyone can reopen it.`;
    if (!window.confirm(warning)) return;

    setEnding(true);
    onError?.(null);
    try {
      await meetingApi.end(meeting.code);
      await onEnded?.();
    } catch (endError) {
      onError?.(endError.message);
      // Only on failure. On success this card is about to be unmounted by the
      // reload, and setting state on the way out is pointless noise.
      setEnding(false);
    }
  }

  return (
    <div className="dash__card">
      <button type="button" className="dash__card-main" onClick={onOpen}>
        <strong>{meeting.title}</strong>
        <span className="meta">
          {inCall} in the call
          {meeting.viewer?.isHost ? ' · you host' : ` · ${meeting.host?.name ?? 'someone else'}`}
          {meeting.startedAt ? ` · ${startedAgo(meeting.startedAt)}` : ''}
        </span>
        <span className="dash__card-join">Join</span>
      </button>

      {/*
        * Host only, because only a host may end a meeting. The server refuses
        * anyone else, and a button that always fails is worse than no button.
        */}
      {meeting.viewer?.isHost ? (
        <button
          type="button"
          className="dash__card-end"
          disabled={ending}
          aria-label={`Close ${meeting.title}`}
          onClick={end}
        >
          {ending ? 'Closing…' : 'Close'}
        </button>
      ) : null}
    </div>
  );
}

export default LiveCard;
