export const CONFIG = {
  APP_ID: __APP_ID__ as string,
  APP_NAME: 'webOS IPTV Player',
  VERSION: __APP_VERSION__ as string,

  STORAGE_PREFIX: 'iptv_',

  // Bundled webOS JS service (see upload-service/) for LAN playlist uploads.
  SERVICE_ID: __SERVICE_ID__,
  SERVICE_HOST: '127.0.0.1',

  PLAYLIST_REFRESH_INTERVAL: 6 * 60 * 60 * 1000,
  EPG_REFRESH_INTERVAL: 12 * 60 * 60 * 1000,
  PLAYER: {
    OSD_TIMEOUT: 5000,
    BUFFER_LENGTH: 30,
    CHANNEL_NUMBER_TIMEOUT: 2000,
    SEEK_STEP: 30, // seconds per Left/Right press while seeking catch-up
    HLS_MAX_RECOVERIES: 3, // bounded hls.js fatal-error retries before giving up → next channel
    STALL_POLL_MS: 2000,      // native stall watchdog: currentTime poll interval
    STALL_FREEZE_TICKS: 5,    // ~10s frozen before the first in-place reload
    STALL_MAX_RELOADS: 2,     // in-place reloads before escalating to the next channel
  },

  EPG: {
    VISIBLE_HOURS: 6,
    PIXELS_PER_MINUTE: (1920 - 200) / (6 * 60),
    TIME_SLOT_MINUTES: 30,
  },

  KEYS: {
    UP: 38,
    DOWN: 40,
    LEFT: 37,
    RIGHT: 39,
    ENTER: 13,
    BACK: 461,
    ESC: 27, // Escape key for desktop, maps to Back
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
    CH_UP: 33,
    CH_DOWN: 34,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    NUM_0: 48,
    NUM_9: 57,
  },
} as const;
