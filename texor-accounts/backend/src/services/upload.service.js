/**
 * Profile picture uploads, via Cloudinary.
 *
 * The browser uploads straight to Cloudinary; this server only signs the
 * request and records the result. Two reasons that is the right shape:
 * image bytes never occupy an API process, and there is no upload endpoint
 * here for someone to point a firehose at.
 *
 * The API secret never leaves the server. What the browser receives is a
 * signature over a fixed set of parameters, valid for one upload into one
 * folder — it cannot be reused to overwrite somebody else's asset.
 *
 * Cloudinary's signing scheme is a SHA-1 of the sorted parameters with the API
 * secret appended, which is a handful of lines, so the SDK is not needed.
 */
import { createHash } from 'node:crypto';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const API_BASE = 'https://api.cloudinary.com/v1_1';

/** Signature validity. Long enough to pick a file, short enough to not linger. */
const SIGNATURE_TTL_SECONDS = 10 * 60;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function assertConfigured() {
  if (!env.uploadsEnabled) {
    throw ApiError.badRequest(
      'Picture uploads are not configured on this Texor deployment. Paste an image URL instead.',
    );
  }
}

/** SHA-1 over the sorted params, with the secret appended. Cloudinary's scheme. */
function sign(params) {
  const payload = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1').update(payload + env.CLOUDINARY_API_SECRET).digest('hex');
}

/**
 * Everything the browser needs to upload one picture, and nothing more.
 *
 * The upload is pinned to a per-user folder and a fixed public id, so a
 * signature issued to one account cannot write into another's, and a person's
 * own new picture simply replaces their old one.
 */
export function createUploadSignature(user) {
  assertConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${env.CLOUDINARY_FOLDER}/${user._id.toString()}`;
  const publicId = `avatar-${timestamp}`;

  const params = {
    folder,
    public_id: publicId,
    timestamp,
    // Normalised server-side by Cloudinary, so an enormous photograph does not
    // become an enormous avatar.
    transformation: 'c_fill,g_face,h_512,w_512,q_auto,f_auto',
  };

  return {
    signature: sign(params),
    timestamp,
    folder,
    publicId,
    transformation: params.transformation,
    apiKey: env.CLOUDINARY_API_KEY,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    uploadUrl: `${API_BASE}/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    expiresInSeconds: SIGNATURE_TTL_SECONDS,
    maxBytes: MAX_BYTES,
    allowedFormats: ALLOWED_FORMATS,
  };
}

/**
 * Accepts the result of a browser upload.
 *
 * The URL is not taken on trust: it has to be a Cloudinary URL on our own cloud,
 * inside the folder we signed for this user. Otherwise this endpoint would be a
 * way to point somebody's avatar at any image on the internet, which is both a
 * tracking vector and an easy way to host something unpleasant under a Texor URL.
 */
export function validateUploadResult({ secureUrl, publicId }, user) {
  assertConfigured();

  const expectedPrefix = `${env.CLOUDINARY_FOLDER}/${user._id.toString()}/`;

  if (typeof publicId !== 'string' || !publicId.startsWith(expectedPrefix)) {
    throw ApiError.badRequest('That upload does not belong to your account.');
  }

  let url;
  try {
    url = new URL(secureUrl);
  } catch {
    throw ApiError.badRequest('That upload result is not a valid URL.');
  }

  const validHost = url.protocol === 'https:'
    && (url.hostname === 'res.cloudinary.com' || url.hostname.endsWith('.cloudinary.com'));

  if (!validHost || !url.pathname.includes(env.CLOUDINARY_CLOUD_NAME)) {
    throw ApiError.badRequest('That upload result did not come from Texor’s image service.');
  }

  return { secureUrl: url.toString(), publicId };
}

/**
 * Removes a previously uploaded asset.
 *
 * Best-effort: failing to delete an old avatar must never stop someone setting
 * a new one, so this reports and moves on.
 */
export async function destroyAsset(publicId) {
  if (!publicId || !env.uploadsEnabled) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ public_id: publicId, timestamp });

  try {
    const response = await fetch(`${API_BASE}/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        public_id: publicId,
        timestamp,
        signature,
        api_key: env.CLOUDINARY_API_KEY,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn('could not delete old avatar', { publicId, status: response.status });
    }
  } catch (error) {
    logger.warn('could not delete old avatar', { publicId, message: error.message });
  }
}
