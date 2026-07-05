/**
 * Bundled webOS JS service for the IPTV player. Currently hosts the LAN M3U
 * upload feature (HTTP + Luna); see upload/server.ts.
 *
 * Entry point: resolves the data dir, registers Luna handlers, and starts
 * the HTTP server on an OS-assigned port. The bound port is reported back to
 * the in-app client via the Luna `start` response. All upload HTTP/storage
 * code lives in upload/server.ts.
 */

import * as http from 'http';
import { startServer, resolveDataDir } from './upload/server';

// Service id from services.json — the file webOS hubd reads to register
// this service on the Luna bus. Passing anything else into `new Service()`
// would fail to bind.
const SERVICE_ID: string = require('./services.json').id;
const DATA_DIR = resolveDataDir(process.env.WEBOS_UPLOAD_DIR);

console.log('[upload] starting, SERVICE_ID=' + SERVICE_ID + ', DATA_DIR=' + DATA_DIR);

let server: http.Server | null = null;
let actualPort: number | null = null;
// Buffer for `start` messages that arrive before the HTTP server has finished
// binding. We respond synchronously once the bind resolves to avoid using
// `await` inside the Luna handler — async handlers break the message/activity
// scoping in webos-service and cause the service process to exit after the
// first respond().
const pendingStarts: Array<{ respond: (r: unknown) => void }> = [];

// Subscribers to the `uploadEvents` push channel. Each entry is a Luna msg
// retained from a subscribe request; the service calls msg.respond() to push.
type LunaMsg = {
  respond: (r: unknown) => void;
  isSubscription?: boolean;
  // Per webos-service: msg is an EventEmitter; clients dropping their end
  // surface as a 'cancel' event on the msg. We use this for subscription
  // cleanup. (msg.cancel() exists too but is a *server-side* trigger taking
  // no arguments, not a callback-registering API.)
  on?: (event: 'cancel', listener: () => void) => void;
};
const subscribers = new Set<LunaMsg>();

function broadcastUploadChange(): void {
  if (subscribers.size === 0) return;
  console.log('[upload] broadcasting upload change to ' + subscribers.size + ' subscriber(s)');
  for (const sub of subscribers) {
    try {
      sub.respond({ event: 'uploads-changed' });
    } catch (e) {
      console.warn('[upload] subscriber respond failed, dropping:', e);
      subscribers.delete(sub);
    }
  }
}

let Service;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Service = require('webos-service');
} catch (e) {
  // Not on webOS (e.g. local testing) — start the HTTP server directly.
  console.log('[upload] webos-service not available (' + (e instanceof Error ? e.message : String(e)) +
    '), falling back to direct HTTP listener');
  startServer(0, DATA_DIR, broadcastUploadChange)
    .then((r) => { server = r.server; actualPort = r.port; })
    .catch((err) => console.error('[upload] startServer failed:', err));
}

if (Service) {
  try {
    const service = new Service(SERVICE_ID);
    console.log('[upload] registered with Luna as ' + SERVICE_ID);

    // Bind state shared across start/stop cycles. The HTTP server is created
    // eagerly at module load AND lazily on `start` after a `stop`, since the
    // service process stays alive across the cycle (webos-service holds the
    // Luna bus connection, keeping Node's event loop running even after we
    // close the HTTP server and complete the keepAlive activity).
    let keepAliveCreated = false;
    let bindInProgress = false;

    function ensureServer(): void {
      if (server || bindInProgress) return;
      bindInProgress = true;
      console.log('[upload] (re)binding HTTP server');
      startServer(0, DATA_DIR, broadcastUploadChange).then((r) => {
        bindInProgress = false;
        server = r.server;
        actualPort = r.port;
        console.log('[upload] HTTP server ready on port ' + actualPort);
        if (!keepAliveCreated) {
          service.activityManager.create('keepAlive', () => { /* keep service alive */ });
          keepAliveCreated = true;
        }
        // Drain any `start` calls that arrived before this bind finished.
        for (const m of pendingStarts) m.respond({ running: true, port: actualPort });
        pendingStarts.length = 0;
      }).catch((err) => {
        bindInProgress = false;
        console.error('[upload] startServer failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        for (const m of pendingStarts) m.respond({ running: false, error: msg });
        pendingStarts.length = 0;
      });
    }

    // Eager bind at module load — keeps cold-start latency low for the first
    // `start` call (most common case).
    ensureServer();

    service.register('start', (msg: { respond: (r: unknown) => void }) => {
      console.log('[upload] start method invoked');
      if (actualPort !== null) {
        msg.respond({ running: true, port: actualPort });
      } else {
        // Server still binding (or was torn down by stop and needs a fresh
        // bind) — queue this msg and kick a bind if one isn't already in
        // flight. The queue drains as soon as the bind resolves.
        pendingStarts.push(msg);
        ensureServer();
      }
    });

    service.register('heartbeat', (msg: { respond: (r: unknown) => void }) => {
      msg.respond({ running: !!server, port: actualPort });
    });

    // Graceful shutdown. The app calls this when it is backgrounded
    // (visibility → hidden) so the LAN HTTP port is released. The Node
    // process stays alive (Luna connection keeps the event loop running) so
    // a subsequent `start` rebinds via ensureServer() — Luna does NOT need
    // to respawn us.
    service.register('stop', (msg: { respond: (r: unknown) => void }) => {
      console.log('[upload] stop method invoked');
      // Drop all push subscribers — their connections are scoped to this
      // service lifetime and would be stale after a restart anyway.
      const droppedSubs = subscribers.size;
      subscribers.clear();
      try {
        service.activityManager.complete('keepAlive', () => {
          console.log('[upload] keepAlive activity completed');
        });
      } catch (e) {
        console.warn('[upload] activityManager.complete failed (ignoring):', e);
      }
      keepAliveCreated = false;
      const wasRunning = !!server;
      if (server) {
        const s = server;
        server = null;
        actualPort = null;
        s.close((err) => {
          if (err) console.warn('[upload] server.close error:', err);
          else console.log('[upload] HTTP server closed');
        });
      }
      msg.respond({ stopped: wasRunning, droppedSubscribers: droppedSubs });
    });

    // Push channel: clients call this once with subscribe:true and the service
    // calls msg.respond({event:'uploads-changed'}) whenever the upload set
    // mutates (POST /uploads or DELETE /uploads/:id succeeded).
    service.register('uploadEvents', (msg: LunaMsg) => {
      if (msg.isSubscription) {
        subscribers.add(msg);
        console.log('[upload] uploadEvents subscriber added, total=' + subscribers.size);
        // Per webos-service API: clients drop themselves by closing their end,
        // which the lib surfaces as a 'cancel' event on the msg. msg.cancel()
        // (no-arg) is a server-side trigger that we never need to call.
        if (typeof msg.on === 'function') {
          msg.on('cancel', () => {
            subscribers.delete(msg);
            console.log('[upload] uploadEvents subscriber cancelled, total=' + subscribers.size);
          });
        }
      }
      msg.respond({ subscribed: !!msg.isSubscription });
    });
  } catch (e) {
    console.error('[upload] failed to register Luna service:', e);
    throw e;
  }
}
