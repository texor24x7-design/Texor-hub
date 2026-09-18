'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { StartMeetingDialog } from '@/components/StartMeetingDialog';
import { Alert, Avatar, Button, Loading, formatTimestamp } from '@/components/ui';
import { channels as channelApi } from '@/lib/api';

export default function ChannelPage({ params }) {
  const { id } = use(params);
  return <AppShell>{(user) => <ChannelView id={id} user={user} />}</AppShell>;
}

function ChannelView({ id, user }) {
  const router = useRouter();
  const [list, setList] = useState([]);
  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const bottomRef = useRef(null);

  const loadChannel = useCallback(async () => {
    try {
      const [{ channels }, { channel: current }, { messages: history }] = await Promise.all([
        channelApi.list(),
        channelApi.get(id),
        channelApi.messages(id),
      ]);
      setList(channels);
      setChannel(current);
      setMessages(history);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [id]);

  useEffect(() => { loadChannel(); }, [loadChannel]);

  // Poll for new messages. A websocket is the eventual answer; polling keeps
  // the first version simple and works through any proxy.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { messages: history } = await channelApi.messages(id);
        setMessages(history);
      } catch {
        // A transient failure here is not worth interrupting the user for;
        // the next tick will pick it up.
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  async function send(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    try {
      const { message } = await channelApi.post(id, { body });
      setMessages((prev) => [...(prev ?? []), message]);
      setDraft('');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  async function join() {
    try {
      await channelApi.join(id);
      await loadChannel();
    } catch (joinError) {
      setError(joinError.message);
    }
  }

  async function remove(messageId) {
    try {
      await channelApi.removeMessage(id, messageId);
      setMessages((prev) => prev.filter((message) => message._id !== messageId));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  if (!channel && !error) return <Loading label="Opening channel" />;

  return (
    <div className="chat">
      <ChannelSidebar
        list={list}
        activeId={id}
        onCreated={(created) => router.push(`/channels/${created._id}`)}
      />

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
        <Alert kind="error">{error}</Alert>

        {/*
          * Created against the channel, which is what makes the backend post
          * the joining link into the conversation — so everyone reading gets it
          * without the person who started it having to paste anything.
          */}
        {starting && channel ? (
          <StartMeetingDialog
            defaultTitle={`#${channel.slug}`}
            defaultAccess={channel.visibility === 'private' ? 'invited' : 'texor'}
            channelId={id}
            onClose={() => setStarting(false)}
            onStarted={(meeting) => router.push(`/meetings/${meeting.code}`)}
          />
        ) : null}

        {channel ? (
          <>
            <div className="row row--between row--wrap" style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2>{channel.visibility === 'private' ? '🔒' : '#'} {channel.slug}</h2>
                <p className="meta">
                  {channel.topic || 'No topic set'} · {channel.memberTexorIds.length} member
                  {channel.memberTexorIds.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="row" style={{ gap: '0.4rem' }}>
                {channel.isMember ? (
                  <>
                    <Button size="sm" onClick={() => setStarting(true)}>Start a meeting</Button>
                    <Button variant="ghost" size="sm" onClick={async () => { await channelApi.leave(id); router.push('/channels'); }}>
                      Leave
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={join}>Join channel</Button>
                )}
              </div>
            </div>

            <div className="messages grow" style={{ overflowY: 'auto', flex: 1 }}>
              {messages === null ? (
                <p className="muted">Loading messages&hellip;</p>
              ) : messages.length === 0 ? (
                <div className="empty">No messages yet. Say hello.</div>
              ) : (
                messages.map((message) => (
                  <article className="message" key={message._id}>
                    <Avatar user={{ displayName: message.authorName, picture: message.authorPicture }} />
                    <div className="grow">
                      <div className="message__head">
                        <span className="message__author">{message.authorName}</span>
                        <span className="meta">{formatTimestamp(message.createdAt)}</span>
                        {message.authorTexorId === user.texorId ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm message__delete"
                            onClick={() => remove(message._id)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                      <div className="message__body">{message.body}</div>
                    </div>
                  </article>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {channel.isMember ? (
              <form className="composer" onSubmit={send}>
                <textarea
                  className="input grow"
                  rows={1}
                  placeholder={`Message #${channel.slug}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends; Shift+Enter makes a new line.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send(event);
                    }
                  }}
                />
                <Button type="submit" loading={sending} disabled={!draft.trim()}>Send</Button>
              </form>
            ) : (
              <p className="meta" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                Join this channel to post a message.
              </p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
