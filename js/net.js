/* ============================================================
   net.js — WebSocket 客户端

   与服务端保持一条长连接：
     · 客户端只发「意图」（我要下这里、我要重新开始）
     · 服务端回「事实」（权威状态快照、请求通知）
   断线自动重连，重连后服务端会把我们放回原来的席位。
   ============================================================ */
(function (GM) {
  'use strict';

  const C = GM.CONFIG;

  const Net = {

    ws: null,
    url: '',
    connected: false,
    sessionId: '',
    name: '',
    lastError: '',

    onMessage: null,     // (msg) => void
    onState: null,       // ('connecting' | 'open' | 'closed') => void

    _timer: null,
    _retry: 0,
    _manual: false,

    /* ---------- 地址推断 ---------- */

    /* 网页由服务端托管时同源即可；用 file:// 打开时需要用户手填 */
    resolveUrl: function () {
      const proto = location.protocol;
      if (proto === 'http:' || proto === 'https:') {
        return (proto === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      }
      const manual = GM.store.get(C.KEY_SERVER, '');
      if (!manual) return '';
      return manual.replace(/\/+$/, '').replace(/^http/i, 'ws') + '/ws';
    },

    saveServer: function (url) {
      const clean = String(url || '').trim().replace(/\/+$/, '');
      GM.store.set(C.KEY_SERVER, clean);
      return clean;
    },

    /* ---------- 身份 ---------- */

    ensureSession: function () {
      if (!this.sessionId) {
        this.sessionId = GM.store.get(C.KEY_SESSION, '')
          || ('s' + Math.random().toString(36).slice(2, 12));
        GM.store.set(C.KEY_SESSION, this.sessionId);
      }
      return this.sessionId;
    },

    /* ---------- 连接 ---------- */

    connect: function (url) {
      const self = this;

      this.close();
      this.url = url || this.resolveUrl();
      if (!this.url) {
        this._setState('closed');
        return false;
      }

      this._manual = false;
      this._setState('connecting');

      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (e) {
        this.lastError = '无法建立连接';
        this._setState('closed');
        return false;
      }
      this.ws = socket;

      socket.onopen = function () {
        self._retry = 0;
        self.connected = true;
        self.lastError = '';
        self._setState('open');
        /* 第一件事永远是自我介绍，服务端据此恢复席位 */
        self.send({
          t: 'hello',
          sessionId: self.ensureSession(),
          name: self.name
        });
      };

      socket.onmessage = function (ev) {
        let msg = null;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (msg && self.onMessage) self.onMessage(msg);
      };

      socket.onclose = function () {
        self.connected = false;
        self.ws = null;
        self._setState('closed');
        if (!self._manual) self._scheduleReconnect();
      };

      socket.onerror = function () {
        self.lastError = '连接出错';
      };

      return true;
    },

    _scheduleReconnect: function () {
      const self = this;
      clearTimeout(this._timer);
      this._retry++;
      /* 退避重连：0.5s、1s、1.5s …… 最多 5s 一次 */
      const delay = Math.min(500 * this._retry, 5000);
      this._timer = setTimeout(function () {
        if (!self._manual) self.connect(self.url);
      }, delay);
    },

    /* ---------- 发送 ---------- */

    send: function (obj) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch (e) {
        return false;
      }
    },

    /* ---------- 关闭 ---------- */

    close: function () {
      this._manual = true;
      clearTimeout(this._timer);
      this._timer = null;
      this.connected = false;

      const socket = this.ws;
      this.ws = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(); } catch (e) { /* 忽略 */ }
      }
    },

    _setState: function (state) {
      if (this.onState) this.onState(state);
    }
  };

  GM.Net = Net;

})(window.GM = window.GM || {});
