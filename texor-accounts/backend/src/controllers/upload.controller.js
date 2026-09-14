/**
 * Profile picture uploads.
 *
 * Two steps, because the file itself goes straight from the browser to
 * Cloudinary and never through this API:
 *
 *   POST /api/account/picture/signature   what the browser needs to upload
 *   PUT  /api/account/picture             record the result
 *   DELETE /api/account/picture           remove it
 */
import { z } from 'zod';
import env from '../config/env.js';
import { toPublicUser } from '../services/user.service.js';
import { createUploadSignature, destroyAsset, validateUploadResult } from '../services/upload.service.js';

export const pictureSchema = z.object({
  secureUrl: z.url(),
  publicId: z.string().min(1),
});

export function getUploadSignature(req, res) {
  res.json({ upload: createUploadSignature(req.user) });
}

export async function putPicture(req, res) {
  const { secureUrl, publicId } = validateUploadResult(req.body, req.user);

  const previous = req.user.picturePublicId;

  req.user.picture = secureUrl;
  req.user.picturePublicId = publicId;
  await req.user.save();

  // Only after the new one is safely recorded, so a failure here cannot leave
  // an account with no picture at all.
  if (previous && previous !== publicId) await destroyAsset(previous);

  res.json({ user: toPublicUser(req.user) });
}

export async function deletePicture(req, res) {
  const previous = req.user.picturePublicId;

  req.user.picture = '';
  req.user.picturePublicId = '';
  await req.user.save();

  if (previous) await destroyAsset(previous);

  res.json({ user: toPublicUser(req.user) });
}

/** Lets the UI decide between an upload button and a plain URL field. */
export function getUploadStatus(_req, res) {
  res.json({ uploadsEnabled: env.uploadsEnabled });
}
