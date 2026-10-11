/* ============================================================
   config.js — 全局配置与常量
   ============================================================ */
(function (GM) {
  'use strict';

  GM.CONFIG = {
    /* 棋盘默认规格（实际以服务端下发的为准） */
    BOARD_SIZE: 15,
    WIN_COUNT: 5,

    /* 星位坐标 [x, y]（0 起算） */
    STARS: [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]],

    /* 本地存储键名 */
    KEY_THEME: 'gomoku.theme',
    KEY_SOUND: 'gomoku.sound',
    KEY_COORDS: 'gomoku.coords',
    KEY_NAME: 'gomoku.name',
    KEY_SERVER: 'gomoku.server',      // 手动填写的服务端地址（file:// 场景）
    KEY_SESSION: 'gomoku.session',    // 会话标识，用于断线重连回原席位

    /* 交互参数 */
    CHAT_MAX_LENGTH: 60,              // 单条消息最大长度（服务端也会再裁一次）
    MOVE_COOLDOWN_MS: 90,             // 本地落子节流，避免连点刷屏
    TYPING_THROTTLE_MS: 1600          // 「正在输入」提示的发送间隔
  };

  /* 棋盘配色：随主题切换 */
  GM.BOARD_THEMES = {
    light: {
      bgFrom:  '#f2dcb8',
      bgTo:    '#e0bd8c',
      grain:   'rgba(150, 108, 60, .10)',
      line:    'rgba(126, 88, 46, .55)',
      border:  'rgba(104, 70, 34, .70)',
      star:    'rgba(104, 70, 34, .85)',
      coord:   'rgba(112, 78, 42, .70)',
      winRing: 'rgba(224, 75, 75, .95)',
      winGlow: 'rgba(224, 75, 75, .28)',
      markOnDark:  '#f5f5f2',
      markOnLight: '#20242e'
    },
    dark: {
      bgFrom:  '#3a3227',
      bgTo:    '#2a2419',
      grain:   'rgba(255, 220, 170, .045)',
      line:    'rgba(214, 180, 132, .26)',
      border:  'rgba(214, 180, 132, .40)',
      star:    'rgba(214, 180, 132, .55)',
      coord:   'rgba(206, 176, 134, .50)',
      winRing: 'rgba(255, 118, 118, .95)',
      winGlow: 'rgba(255, 118, 118, .26)',
      markOnDark:  '#f5f5f2',
      markOnLight: '#20242e'
    }
  };

  /* 消息类型。与服务端 server/protocol.py 保持一致。
     同一个字符串在两个方向上含义不同，靠上下文区分。 */
  GM.MSG = {
    /* 客户端 → 服务端 */
    HELLO:     'hello',
    LIST:      'list',
    CREATE:    'create',
    PRACTICE:  'practice',
    JOIN:      'join',
    SPECTATE:  'spectate',
    MOVE:      'move',
    RESTART:   'restart',
    UNDO:      'undo',
    RESPOND:   'respond',
    SURRENDER: 'surrender',
    CHAT:      'chat',
    LEAVE:     'leave',

    /* 服务端 → 客户端 */
    WELCOME:   'welcome',
    ROOMS:     'rooms',
    ROOM:      'room',
    STATE:     'state',
    REQUEST:   'request',
    ERROR:     'error',
    PEER:      'peer',
    INFO:      'info'
  };

})(window.GM = window.GM || {});
