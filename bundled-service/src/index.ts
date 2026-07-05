/**
 * Bundled webOS JS service for the IPTV player — thin entry point.
 *
 * Resolves the data dir, binds the Luna service, and wires up each feature
 * module: upload (LAN M3U uploads over HTTP + Luna; see upload/) and reminder
 * alerts (dev-mode interactive createAlert; see reminder/). Off webOS (local
 * testing) it falls back to a direct upload HTTP listener.
 */

import { resolveDataDir } from './upload/server';
import { registerUploadService, startUploadStandalone } from './upload/service';
import { registerReminderService } from './reminder/service';

// Service id from services.json — the file webOS hubd reads to register
// this service on the Luna bus. Passing anything else into `new Service()`
// would fail to bind.
const SERVICE_ID: string = require('./services.json').id;
const DATA_DIR = resolveDataDir(process.env.WEBOS_UPLOAD_DIR);

console.log('[service] starting, SERVICE_ID=' + SERVICE_ID + ', DATA_DIR=' + DATA_DIR);

let Service;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Service = require('webos-service');
} catch (e) {
  console.log('[service] webos-service not available (' + (e instanceof Error ? e.message : String(e)) +
    '), falling back to direct HTTP listener');
  startUploadStandalone(DATA_DIR);
}

if (Service) {
  try {
    const service = new Service(SERVICE_ID);
    console.log('[service] registered with Luna as ' + SERVICE_ID);
    registerUploadService(service, DATA_DIR);
    registerReminderService(service);
  } catch (e) {
    console.error('[service] failed to register Luna service:', e);
    throw e;
  }
}
