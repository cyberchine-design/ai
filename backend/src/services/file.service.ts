import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

const UPLOADS_BASE = process.env.UPLOADS_BASE || '/var/data/uploads';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecrettokenkeymiunicorn';
const TEMP_TTL_DAYS = 7;

export interface TempFile {
  id: string;
  filename: string;
  type: string;
  size_bytes: number;
  expires_at: string;
  download_url: string;
}

function emailToFolder(email: string): string {
  return Buffer.from(email).toString('base64url');
}

function userDir(email: string, subdir: string = 'temp_download'): string {
  return path.join(UPLOADS_BASE, subdir, emailToFolder(email));
}

function getEmailFromToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    return payload.email || null;
  } catch {
    return null;
  }
}

function fileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return ext || 'other';
}

export function listTempFiles(email: string): TempFile[] {
  const dir = userDir(email);
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - TEMP_TTL_DAYS * 86400 * 1000;
  const files = fs.readdirSync(dir)
    .map(name => {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.mtimeMs < cutoff) return null;
        return { name, full, stat };
      } catch {
        return null;
      }
    })
    .filter((x): x is { name: string; full: string; stat: fs.Stats } => x !== null);

  return files.map(({ name, full, stat }) => ({
    id: name.replace(/\.[^.]+$/, ''),
    filename: name,
    type: fileType(name),
    size_bytes: stat.size,
    expires_at: new Date(stat.mtimeMs + TEMP_TTL_DAYS * 86400 * 1000).toISOString(),
    download_url: `/api/files/temp-download/${encodeURIComponent(name)}`
  }));
}

export function getTempFile(email: string, id: string): { full: string; filename: string } | null {
  if (!/^[a-zA-Z0-9_\-.]{1,64}$/.test(id)) return null;
  const dir = userDir(email);
  const full = path.join(dir, id);
  const resolved = path.resolve(full);
  const resolvedDir = path.resolve(dir);
  if (!resolved.startsWith(resolvedDir + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { full: resolved, filename: id };
}

export { getEmailFromToken, userDir };
