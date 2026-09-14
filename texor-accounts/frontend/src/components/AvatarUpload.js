'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { CameraIcon } from '@/components/icons';
import { account } from '@/lib/api';

/**
 * Profile picture.
 *
 * The file goes straight from the browser to Cloudinary — this app only asks
 * the server for a signature and then reports the result back. Bytes never
 * touch the Texor API, so a large photo cannot occupy a request worker.
 *
 * Where Cloudinary is not configured, the control degrades to the plain URL
 * field it replaced rather than disappearing.
 */
export function AvatarUpload({ user, onChange }) {
  const fileInput = useRef(null);
  const [uploadsEnabled, setUploadsEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [urlValue, setUrlValue] = useState(user.picture ?? '');

  useEffect(() => {
    account.uploadStatus()
      .then((data) => setUploadsEnabled(data.uploadsEnabled))
      .catch(() => setUploadsEnabled(false));
  }, []);

  const initials = (user.displayName ?? user.email ?? '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join('');

  async function upload(file) {
    if (!file) return;

    setError(null);

    // Checked here as well as server-side, so an obviously wrong file fails
    // instantly instead of after a slow upload.
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('That image is larger than 5 MB. Choose a smaller one.');
      return;
    }

    setBusy(true);

    try {
      const { upload: signed } = await account.uploadSignature();

      const form = new FormData();
      form.append('file', file);
      form.append('api_key', signed.apiKey);
      form.append('timestamp', signed.timestamp);
      form.append('signature', signed.signature);
      form.append('folder', signed.folder);
      form.append('public_id', signed.publicId);
      form.append('transformation', signed.transformation);

      const response = await fetch(signed.uploadUrl, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'The image service rejected that upload.');
      }

      const { user: updated } = await account.savePicture({
        secureUrl: result.secure_url,
        publicId: result.public_id,
      });

      onChange(updated);
      setUrlValue(updated.picture);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await account.removePicture();
      onChange(updated);
      setUrlValue('');
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveUrl() {
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await account.updateProfile({ picture: urlValue.trim() });
      onChange(updated);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Alert kind="error">{error}</Alert>

      <div className="avatar-edit">
        <span className="avatar-xl">
          {user.picture ? <img src={user.picture} alt="" /> : initials}
          {busy ? <span className="avatar-xl__busy"><span className="spinner" /></span> : null}
        </span>

        <div className="stack stack--tight">
          {uploadsEnabled ? (
            <>
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button
                  type="button" variant="secondary" size="sm" disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <CameraIcon />
                  {user.picture ? 'Change picture' : 'Upload a picture'}
                </Button>
                {user.picture ? (
                  <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <span className="field__hint">JPG, PNG, WebP or GIF, up to 5 MB. Cropped to a square.</span>

              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => upload(event.target.files?.[0])}
              />
            </>
          ) : uploadsEnabled === false ? (
            <div className="stack stack--tight" style={{ minWidth: '16rem' }}>
              <Field label="Picture URL" htmlFor="pictureUrl" hint="Uploads are not configured on this deployment.">
                <input
                  id="pictureUrl" className="input" type="url" placeholder="https://…"
                  value={urlValue} onChange={(event) => setUrlValue(event.target.value)}
                />
              </Field>
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={saveUrl} loading={busy}>
                  Save picture
                </Button>
              </div>
            </div>
          ) : (
            <span className="meta">Loading…</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default AvatarUpload;
