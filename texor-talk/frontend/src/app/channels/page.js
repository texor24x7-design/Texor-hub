'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { Alert, Loading } from '@/components/ui';
import { channels as channelApi } from '@/lib/api';

export default function ChannelsPage() {
  return <AppShell><ChannelsIndex /></AppShell>;
}

function ChannelsIndex() {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    channelApi.list()
      .then((data) => {
        setList(data.channels);
        // Drop straight into the busiest channel rather than showing an
        // empty split view.
        if (data.channels.length) router.replace(`/channels/${data.channels[0]._id}`);
      })
      .catch((loadError) => setError(loadError.message));
  }, [router]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (list === null) return <Loading label="Loading channels" />;

  if (list.length === 0) {
    return (
      <div className="chat">
        <ChannelSidebar list={[]} onCreated={(channel) => router.push(`/channels/${channel._id}`)} />
        <section className="panel">
          <div className="empty">
            <h2>Welcome to Texor Talk</h2>
            <p style={{ marginTop: '0.5rem' }}>Create a channel to start the conversation.</p>
          </div>
        </section>
      </div>
    );
  }

  return <Loading label="Opening channel" />;
}
