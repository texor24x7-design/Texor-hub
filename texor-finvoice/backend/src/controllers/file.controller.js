import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { findFile, openFile, saveFile } from '../services/file.service.js';

export async function upload(req, res) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw ApiError.badRequest('Choose a file to upload.');
  const file = await saveFile({
    workspace: req.workspace._id,
    user: req.user._id,
    buffer: req.body,
    contentType: String(req.get('content-type') ?? '').split(';')[0].trim(),
    filename: decodeURIComponent(req.get('x-filename') ?? 'upload'),
    purpose: String(req.query.purpose ?? 'attachment').slice(0, 40),
  });
  res.status(201).json({ file, url: `/api/files/${file.key}` });
}

/**
 * Serves a file by key. Keys are unguessable and only handed to people who can
 * see the record they belong to, so this route needs no session — which is also
 * what lets a logo appear on a public invoice link and inside a PDF.
 */
export async function download(req, res) {
  const file = await findFile(req.params.key);
  if (!file) throw ApiError.notFound('File not found.');

  res.set({
    'content-type': file.metadata?.contentType ?? 'application/octet-stream',
    'content-length': String(file.length),
    'cache-control': 'private, max-age=31536000, immutable',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    // The frontend is a different origin; without this helmet's same-origin CORP blocks every <img>.
    'cross-origin-resource-policy': 'cross-origin',
    'x-robots-tag': 'noindex',
  });
  if (file.metadata?.contentType === 'application/pdf') {
    res.set('content-disposition', `inline; filename="${String(file.metadata?.originalName ?? 'file.pdf').replace(/[^\w.-]/g, '_')}"`);
  }
  openFile(file).on('error', () => res.destroy()).pipe(res);
}

export const uploadLimit = () => env.uploadMaxBytes;
