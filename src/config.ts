export const CONFIG = {
  APP_NAME: 'webOS IPTV Player',
  VERSION: __APP_VERSION__ as string,

  STORAGE_PREFIX: 'iptv_',

  PLAYLIST_REFRESH_INTERVAL: 6 * 60 * 60 * 1000,
  EPG_REFRESH_INTERVAL: 12 * 60 * 60 * 1000,
  PLAYER: {
    OSD_TIMEOUT: 5000,
    BUFFER_LENGTH: 30,
    CHANNEL_NUMBER_TIMEOUT: 2000,
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
