'use client';

/**
 * The conversation so far, as a panel beside the call.
 *
 * Two sources, and the distinction matters. While the meeting is running this
 * draws the captions that have arrived on the socket, because they are the only
 * copy that exists in the browser. Once it has ended — or when somebody opens
 * the meeting again next week — the stored transcript is fetched from the
 * server, which is authoritative and includes anything this browser missed
 * while it was reconnecting.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { groupCaptions } from '@/lib/captions';
import { meetings } from '@/lib/api';
import { CheckIcon, CopyIcon, TranscriptIcon } from '@/components/icons';

/** `14:03`, in the reader's own locale. */
const at = (value) =>
  new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function TranscriptPanel({ lines, user, code, captions, stored }) {
  const [copied, setCopied] = useState(false);
  const end = useRef(null);

  const turns = useMemo(() => groupCaptions(lines), [lines]);

  // Follow the conversation, the way the chat log does.
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns.length]);

  /**
   * Copied in exactly the form the transcript is stored and downloaded in, so
   * what somebody pastes into a message matches the file they would have got.
   */
  async function copyAll() {
    const text = turns.map((turn) => `${turn.name}: ${turn.text}`).join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused outright; the download is still there.
    }
  }

  return (
    <div className="meet__transcript">
      <div className="meet__transcript-log">
        <p className="meet__chat-note">
          {captions
            ? stored
              ? 'Captions are on. What is said is being transcribed and kept with this meeting.'
              : 'Captions are on. Nothing is being stored — these lines go when the call ends.'
            : 'Captions are off for this meeting. A host can turn them on.'}
        </p>

        {turns.length === 0 ? (
          <div className="meet__transcript-empty">
            <span aria-hidden="true"><TranscriptIcon /></span>
            <p>{captions ? 'Nothing said yet.' : 'No transcript for this meeting.'}</p>
          </div>
        ) : null}

        {turns.map((turn) => (
          <div
            className={`meet__turn ${turn.final ? '' : 'meet__turn--interim'}`}
            key={turn.key}
          >
            <div className="meet__turn-head">
              <span className="meet__turn-who">
                {turn.texorId === user.texorId ? 'You' : turn.name}
              </span>
              <time className="meet__turn-at" dateTime={new Date(turn.at).toISOString()}>
                {at(turn.at)}
              </time>
            </div>
            <p className="meet__turn-body">{turn.text}</p>
          </div>
        ))}

        <div ref={end} />
      </div>

      {turns.length > 0 ? (
        <div className="meet__transcript-actions">
          <button type="button" className="meet__transcript-action" onClick={copyAll}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          {/*
            * A plain link, not a fetch-and-blob.
            *
            * The server renders the file, so what downloads is the canonical
            * transcript with its header and timestamps — not a second rendering
            * of the lines this browser happens to be holding, which would be
            * missing anything that arrived while it was reconnecting.
            */}
          {stored ? (
            <a
              className="meet__transcript-action"
              href={meetings.transcriptUrl(encodeURIComponent(code))}
              download
            >
              <TranscriptIcon />
              Download
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default TranscriptPanel;
