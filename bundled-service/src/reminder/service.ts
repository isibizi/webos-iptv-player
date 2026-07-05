/**
 * Reminder feature — webOS service integration. Registers the dev-mode probe
 * (getDevMode) and the air-time alert (fireReminderAlert) the Activity Manager
 * callback invokes. The dev-mode check and alert payload/exec live in alert.ts.
 */

import { isDevMode, buildAlertPayload, fireAlert } from './alert';

// Minimal shape of the webos-service Service object this module uses.
interface LunaService {
  register(method: string, handler: (msg: LunaMsg) => void): void;
}

type LunaMsg = {
  respond: (r: unknown) => void;
  payload?: { title?: string; channelName?: string; channelKey?: string; appId?: string };
};

// Wire the reminder feature onto the Luna service.
export function registerReminderService(service: LunaService): void {
  service.register('getDevMode', (msg) => {
    msg.respond({ devmode: isDevMode() });
  });

  // Invoked by the Activity Manager callback at programme air time (dev mode
  // only). The scheduler passes appId (the app's own id) so the "Watch now"
  // button can relaunch it; the service stays app-id-agnostic.
  service.register('fireReminderAlert', (msg) => {
    const { title = '', channelName = '', channelKey = '', appId = '' } = msg.payload || {};
    console.log('[reminder] fireReminderAlert for "' + title + '"');
    fireAlert(buildAlertPayload(title, channelName, channelKey, appId),
      (result) => msg.respond({ fired: true, result }));
  });
}
