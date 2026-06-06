/**
 * HTTP server and storage for the upload service. The Luna registration
 * entry point lives in index.ts and passes the resolved data directory
 * into startServer().
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface UploadMeta {
  id: string;
  name: string;
  count: number;
  createdAt: number;
}

/**
 * Probe a list of candidate dirs and return the first writable one. The
 * service install dir is read-only and /tmp is wiped on reboot, so prefer
 * persistent storage. Logs each probe so failures are visible in the device
 * log (you can curl /info or check the service stdout to confirm).
 */
export function resolveDataDir(envOverride?: string): string {
  const candidates: string[] = [
    envOverride,
    '/media/internal/iptv-uploads',
    path.join(__dirname, 'uploads'),
    '/tmp/iptv-uploads',
  ].filter((c): c is string => !!c);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      console.log('[upload] resolveDataDir: using ' + dir);
      return dir;
    } catch (e) {
      console.log('[upload] resolveDataDir: candidate ' + dir + ' not writable: ' +
        (e instanceof Error ? e.message : String(e)));
    }
  }

  const fallback = '/tmp/iptv-uploads';
  try { fs.mkdirSync(fallback, { recursive: true }); } catch { /* ignore */ }
  console.warn('[upload] resolveDataDir: all candidates failed, falling back to ' + fallback);
  return fallback;
}

function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return 'localhost';
}

function sanitizeId(name: string): string {
  const base = String(name).replace(/\.m3u8?$/i, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'playlist';
}

function countChannels(content: string): number {
  const matches = content.match(/^#EXTINF:/gm);
  return matches ? matches.length : 0;
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

function readBody(req: http.IncomingMessage, limitBytes = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Upload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// The upload page HTML lives in upload-page.html beside this file so it can be
// edited as real HTML. The file is copied into the build output by build.sh.
let _uploadPageCache: string | null = null;
function uploadPageHtml(): string {
  if (_uploadPageCache !== null) return _uploadPageCache;
  _uploadPageCache = fs.readFileSync(path.join(__dirname, 'upload-page.html'), 'utf-8');
  return _uploadPageCache;
}

/**
 * Bind the HTTP server on all interfaces. Pass `0` to let the OS assign a
 * free ephemeral port (typical production use — the bound port is returned
 * via the resolved promise and reported to the in-app client through Luna).
 *
 * `dataDir` is where uploaded .m3u files and their .json metadata live; pass
 * the result of resolveDataDir() (or any writable directory for tests).
 *
 * `onChange` is invoked synchronously after any write that mutates the upload
 * set (successful POST /uploads or DELETE /uploads/:id). Use it to fan out a
 * push notification to subscribers (see index.ts `uploadEvents`).
 */
export function startServer(
  port: number,
  dataDir: string,
  onChange?: () => void,
): Promise<{ server: http.Server; port: number }> {
  let boundPort = port;
  const metaPath = (id: string): string => path.join(dataDir, id + '.json');
  const filePath = (id: string): string => path.join(dataDir, id + '.m3u');

  function listUploads(): UploadMeta[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(dataDir);
    } catch {
      return [];
    }
    const out: UploadMeta[] = [];
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')) as UploadMeta;
        if (fs.existsSync(filePath(meta.id))) out.push(meta);
      } catch {
        // skip malformed meta
      }
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
  }

  function saveUpload(rawName: string, content: string): UploadMeta {
    if (!/#EXTM3U/.test(content) && !/^#EXTINF:/m.test(content)) {
      throw new Error('Not a valid M3U playlist (missing #EXTM3U/#EXTINF)');
    }
    const id = sanitizeId(rawName || 'playlist');
    const name = String(rawName || id).replace(/\.m3u8?$/i, '').trim() || id;
    const meta: UploadMeta = { id, name, count: countChannels(content), createdAt: Date.now() };
    const m3uPath = filePath(id);
    const jsonPath = metaPath(id);
    fs.writeFileSync(m3uPath, content, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(meta), 'utf-8');
    console.log('[upload] wrote ' + m3uPath + ' (' + content.length + ' bytes)');
    console.log('[upload] wrote ' + jsonPath);
    return meta;
  }

  function deleteUpload(id: string): boolean {
    let removed = false;
    for (const p of [filePath(id), metaPath(id)]) {
      try {
        fs.unlinkSync(p);
        console.log('[upload] removed ' + p);
        removed = true;
      } catch { /* file already gone — skip */ }
    }
    return removed;
  }

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const urlObj = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    const pathname = urlObj.pathname;
    const query = urlObj.searchParams;
    const host = req.headers.host || ('localhost:' + boundPort);

    try {
      if (pathname === '/info') {
        const ip = getLanIp();
        const hostPort = host.indexOf(':') >= 0 ? host.split(':')[1] : String(boundPort);
        sendJson(res, 200, {
          ip,
          port: parseInt(hostPort, 10) || boundPort,
          uploadUrl: 'http://' + ip + ':' + hostPort + '/upload',
          dataDir,
        });
      } else if (pathname === '/upload') {
        send(res, 200, 'text/html; charset=utf-8', uploadPageHtml());
      } else if (pathname === '/uploads' && req.method === 'POST') {
        try {
          const content = await readBody(req);
          const meta = saveUpload(query.get('name') || 'playlist.m3u', content);
          console.log('[upload] saved "' + meta.name + '" (' + meta.count + ' channels) as ' + meta.id + '.m3u');
          try { onChange?.(); } catch (cbErr) { console.error('[upload] onChange callback threw:', cbErr); }
          sendJson(res, 200, meta);
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
      } else if (pathname === '/uploads') {
        const base = 'http://' + host;
        const items = listUploads().map((m) => ({
          ...m,
          url: base + '/uploads/' + encodeURIComponent(m.id) + '.m3u',
        }));
        sendJson(res, 200, items);
      } else if (pathname.indexOf('/uploads/') === 0) {
        const id = decodeURIComponent(pathname.slice('/uploads/'.length)).replace(/\.m3u$/i, '');
        if (req.method === 'DELETE') {
          const ok = deleteUpload(id);
          if (ok) { try { onChange?.(); } catch (cbErr) { console.error('[upload] onChange callback threw:', cbErr); } }
          sendJson(res, ok ? 200 : 404, { deleted: ok, id });
        } else {
          try {
            send(res, 200, 'audio/mpegurl; charset=utf-8', fs.readFileSync(filePath(id), 'utf-8'));
          } catch {
            send(res, 404, 'text/plain; charset=utf-8', 'Upload not found: ' + id);
          }
        }
      } else {
        send(res, 404, 'text/plain; charset=utf-8', 'Not found. Use /upload, /uploads, or /info');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.indexOf('EPIPE') >= 0 || msg.indexOf('ECONNRESET') >= 0) return;
      try { send(res, 500, 'text/plain; charset=utf-8', 'Internal error: ' + msg); } catch { /* ignore */ }
    }
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        try { res.writeHead(500); res.end('Internal Server Error'); } catch { /* ignore */ }
      });
    });
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const addr = server.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : port;
      boundPort = actualPort;
      console.log('[upload] listening on http://0.0.0.0:' + actualPort);
      console.log('[upload] upload page: http://' + getLanIp() + ':' + actualPort + '/upload');
      // Permanent error handler so post-listen errors don't crash the process.
      server.on('error', (e) => console.error('[upload] server error:', e));
      resolve({ server, port: actualPort });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}
