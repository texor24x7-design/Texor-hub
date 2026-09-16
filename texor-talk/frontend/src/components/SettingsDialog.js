'use client';

import { useEffect, useRef, useState } from 'react';
import { CameraIcon, CloseIcon, MicIcon, SettingsIcon } from '@/components/icons';
import { describeMediaError } from '@/lib/media-errors';
import { loadPreferences, savePreferences } from '@/lib/preferences';

const TABS = [
  ['audio', 'Audio', <MicIcon key="a" />],
  ['video', 'Video', <CameraIcon key="v" />],
  ['general', 'General', <SettingsIcon key="g" />],
];

/**
 * Device and behaviour settings, reachable from anywhere.
 *
 * Deliberately outside a call as well as inside one: picking the right
 * microphone is something people want to do *before* they are in front of
 * anyone, and having to join a meeting to find the setting is the reason they
 * end up doing it in front of everyone.
 */
export function SettingsDialog({ onClose, inCall = false, onDevice }) {
  const [tab, setTab] = useState('audio');
  const [prefs, setPrefs] = useState(() => loadPreferences());
  const [devices, setDevices] = useState({ mics: [], cameras: [], speakers: [] });
  const [error, setError] = useState(null);
  const dialog = useRef(null);

  // Escape closes, and focus starts inside rather than wherever it was.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        /**
         * Permission first, then enumerate.
         *
         * `enumerateDevices` only reveals ids and labels for kinds already
         * permitted, so asking first is the difference between a real list and
         * three entries all called "Microphone".
         */
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));

        const all = await navigator.mediaDevices.enumerateDevices();
        probe?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;

        setDevices({
          mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
          cameras: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
          speakers: all.filter((d) => d.kind === 'audiooutput' && d.deviceId),
        });
      } catch (deviceError) {
        if (!cancelled) setError(describeMediaError(deviceError, 'audio'));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const update = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePreferences(next);
  };

  return (
    <div className="dialog__scrim" role="presentation" onPointerDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={dialog}
      >
        <div className="dialog__side">
          <h2>Settings</h2>
          <nav>
            {TABS.map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={`dialog__tab ${tab === value ? 'dialog__tab--on' : ''}`}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setTab(value)}
              >
                <span className="dialog__tab-icon">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="dialog__main">
          <button type="button" className="dialog__close" aria-label="Close settings" onClick={onClose}>
            <CloseIcon />
          </button>

          <div className="dialog__body">
            {error ? <div className="dialog__error">{error}</div> : null}

            {tab === 'audio' ? (
              <>
                <Picker
                  label="Microphone"
                  value={prefs.micId}
                  options={devices.mics}
                  empty="No microphone found"
                  onChange={(micId) => { update({ micId }); onDevice?.('mic', micId); }}
                />
                <Picker
                  label="Speakers"
                  value={prefs.speakerId}
                  options={devices.speakers}
                  empty="Using the system default"
                  onChange={(speakerId) => update({ speakerId })}
                />
                <Toggle
                  label="Noise cancellation"
                  hint="Filters out keyboards, fans and background chatter. Leave off for music."
                  on={prefs.noiseSuppression}
                  onChange={(noiseSuppression) => update({ noiseSuppression })}
                />
                <Toggle
                  label="Join muted"
                  hint="Your microphone starts off in every meeting."
                  on={prefs.joinMuted}
                  onChange={(joinMuted) => update({ joinMuted })}
                />
              </>
            ) : null}

            {tab === 'video' ? (
              <>
                <Picker
                  label="Camera"
                  value={prefs.cameraId}
                  options={devices.cameras}
                  empty="No camera found"
                  onChange={(cameraId) => { update({ cameraId }); onDevice?.('camera', cameraId); }}
                />
                <Toggle
                  label="Join with camera off"
                  hint="You can turn it on once you are in."
                  on={prefs.joinCameraOff}
                  onChange={(joinCameraOff) => update({ joinCameraOff })}
                />
                <Toggle
                  label="Mirror my own video"
                  hint="Only affects your own preview — others always see you the right way round."
                  on={prefs.mirror}
                  onChange={(mirror) => update({ mirror })}
                />

                <div className="setting">
                  <label className="setting__label" htmlFor="screenOptimise">
                    When sharing your screen
                  </label>
                  <p className="setting__hint">
                    On a slow connection something has to give. Which matters more depends on what
                    you are showing.
                  </p>
                  <select
                    id="screenOptimise"
                    className="setting__select"
                    value={prefs.screenOptimise ?? 'motion'}
                    onChange={(event) => update({ screenOptimise: event.target.value })}
                  >
                    <option value="motion">Keep it smooth — demos, video, scrolling</option>
                    <option value="detail">Keep it sharp — code, spreadsheets, slides</option>
                  </select>
                </div>
              </>
            ) : null}

            {tab === 'general' ? (
              <>
                <Toggle
                  label="Leave empty calls"
                  hint="Takes you out of a meeting after a few minutes if nobody else joins."
                  on={prefs.leaveEmpty}
                  onChange={(leaveEmpty) => update({ leaveEmpty })}
                />
                <Toggle
                  label="Sounds"
                  hint="A short chime when somebody joins or leaves, and when a meeting ends."
                  on={prefs.sounds}
                  onChange={(sounds) => update({ sounds })}
                />
                <Toggle
                  label="Show reactions"
                  hint="Turn off to stop reactions appearing over the video."
                  on={prefs.showReactions}
                  onChange={(showReactions) => update({ showReactions })}
                />
                <p className="dialog__note">
                  These are kept in this browser only. Nothing here is sent to Texor or shared with
                  anyone in your meetings.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Picker({ label, value, options, empty, onChange }) {
  return (
    <div className="setting">
      <label className="setting__label" htmlFor={`pick-${label}`}>{label}</label>
      <select
        id={`pick-${label}`}
        className="setting__select"
        value={value ?? ''}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{options.length ? 'System default' : empty}</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }) {
  return (
    <div className="setting setting--row">
      <div>
        <div className="setting__label">{label}</div>
        {hint ? <p className="setting__hint">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(on)}
        aria-label={label}
        className={`switchy ${on ? 'switchy--on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="switchy__knob" />
      </button>
    </div>
  );
}

export default SettingsDialog;
