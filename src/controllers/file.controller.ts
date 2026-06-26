import { Request, Response } from 'express';
import fs from 'fs';
import * as fileService from '../services/file.service';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  csv: 'text/csv'
};

export function listTempFiles(req: Request, res: Response) {
  const email = fileService.getEmailFromToken(req.headers.authorization);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const files = fileService.listTempFiles(email);
  return res.json({ files });
}

export function downloadTempFile(req: Request, res: Response) {
  const email = fileService.getEmailFromToken(req.headers.authorization);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'missing id' });

  let decodedId: string;
  try {
    decodedId = decodeURIComponent(id);
  } catch {
    return res.status(400).json({ error: 'invalid id' });
  }

  const file = fileService.getTempFile(email, decodedId);
  if (!file) return res.status(404).json({ error: 'not_found' });

  const ext = decodedId.toLowerCase().split('.').pop() || '';
  const contentType = MIME[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
  fs.createReadStream(file.full).pipe(res);
}
