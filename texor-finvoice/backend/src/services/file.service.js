/**
 * Uploaded files — logos, signatures, product photos, claim photos — kept in
 * MongoDB GridFS so a deployment has nothing else to provision or back up.
 *
 * Files are addressed by a random 32-character key rather than their ObjectId:
 * the key is only handed to people who can see the record it belongs to, and it
 * cannot be guessed from a neighbouring upload.
 *
 * The declared content type is not trusted. The first bytes must match it, and
 * SVG is refused outright because a browser runs the scripts inside one.
 */
import mongoose from 'mongoose';
import ApiError from '../utils/ApiError.js';
import { randomToken } from '../utils/ids.js';

const SIGNATURES = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

export const ALLOWED_TYPES = Object.keys(SIGNATURES);

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'files' });

export async function saveFile({ workspace, user, buffer, contentType, filename = 'upload', purpose = 'attachment' }) {
  const check = SIGNATURES[contentType];
  if (!check) throw ApiError.badRequest('Upload a PNG, JPEG, WebP or PDF file.');
  if (!buffer?.length || !check(buffer)) throw ApiError.badRequest('That file is not what its type says it is.');

  const key = randomToken(24);
  await new Promise((resolve, reject) => {
    bucket()
      .openUploadStream(key, { metadata: { workspace, uploadedBy: user, contentType, originalName: String(filename).slice(0, 200), purpose } })
      .on('error', reject)
      .on('finish', resolve)
      .end(buffer);
  });
  return { key, contentType, size: buffer.length };
}

export async function findFile(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return null;
  return mongoose.connection.db.collection('files.files').findOne({ filename: key });
}

export const openFile = (file) => bucket().openDownloadStream(file._id);

export async function readFileBuffer(key) {
  const file = await findFile(key);
  if (!file) return null;
  const chunks = [];
  for await (const chunk of openFile(file)) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), contentType: file.metadata?.contentType ?? 'application/octet-stream' };
}
