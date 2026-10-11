/* ============================================================
   app.js — 主控制器

   职责边界（客户端只做两件事）：
     1. 把玩家的操作打包成「意图」发给服务端
     2. 把服务端下发的「权威状态」画到界面上

   客户端**不做任何棋局判断** —— 没有胜负计算、没有落子校验。
   服务端说这步合法就是合法，说谁赢了就是谁赢了。
   ============================================================ */
(function (GM) {
  'use strict';

  const C = GM.CONFIG;
  const MSG = GM.MSG;
  const $ = GM.$;
  const $$ = GM.$$;

  const App = {

    /* ---------------- 状态 ---------------- */
    me: { id: '', name: '', seat: 0, room: '' },
    rooms: [],
    model: null,
    renderer: null,

    _n: null,               // DOM 节点缓存
    _ro: null,              // ResizeObserver
    _logScrollRaf: null,
    _chatScrollRaf: null,
    _orientationTimer: null,
    _renderedMoves: -1,
    _lastChatAt: 0,
    _lastMoveAt: 0,
    _leavingRoom: false,

    /* ================= 初始化 ================= */

    init: function () {
      const self = this;

      this.model = new GM.Board();
      this.renderer = new GM.Renderer($('#board'), this.model);

      this._buildNodeCache();
      this._initTheme();
      this._initSound();
      this._initCoords();

      this._bindNav();
      this._bindTopbar();
      this._bindHome();
      this._bindLobbyView();
      this._bindGameView();
      this._bindBoard();
      this._bindBoardResize();
      this._bindChat();
      this._initViewGuard();
      this._initNet();

      GM.Views.onChange = function (name) {
        if (name === 'lobby') self._lobbyEnter();
      };

      GM.Views.show('home', true);
      this._tryAutoConnect();
    },

    /* ================= 节点缓存与最小化写入 ================= */

    _buildNodeCache: function () {
      const connPill = $('#conn-pill');
      this._n = {
        connPill: connPill,
        connText: connPill ? $('.conn-text', connPill) : null,
        chatDot: $('#chat-dot'),
        chatPeer: $('#chat-peer'),
        msgInput: $('#msg-input'),
        msgSend: $('#btn-send-msg'),
        btnSurrender: $('#btn-surrender'),
        btnUndo: $('#btn-undo'),
        btnRestart: $('#btn-restart'),
        statMoves: $('#stat-moves'),
        statTurn: $('#stat-turn'),
        roomCode: $('#room-code'),
        spectateCount: $('#spectate-count'),
        gameLog: $('#game-log'),
        chatBody: $('#chat-body'),
        lobbyRooms: $('#lobby-rooms'),
        lobbyEmpty: $('#lobby-empty'),
        lobbyName: $('#lobby-name'),
        lobbyBadge: $('#lobby-badge'),
        banner: $('#board-banner'),
        me: this._cachePlayer($('#p-me')),
        op: this._cachePlayer($('#p-op'))
      };
    },

    _cachePlayer: function (card) {
      if (!card) return null;
      return {
        card: card,
        name: $('.player-name', card),
        color: $('.player-color', card),
        pill: $('.turn-pill', card)
      };
    },

    _setText: function (node, text) {
      if (node && node.textContent !== text) node.textContent = text;
    },

    _setClass: function (node, cls, on) {
      if (!node) return;
      const want = !!on;
      if (node.classList.contains(cls) !== want) node.classList.toggle(cls, want);
    },

    _setClassName: function (node, name) {
      if (node && node.className !== name) node.className = name;
    },

    _setDisabled: function (node, disabled) {
      if (node && node.disabled !== disabled) node.disabled = disabled;
    },

    /* ================= 主题 / 音效 / 坐标 ================= */

    _initTheme: function () {
      let theme = GM.store.get(C.KEY_THEME, null);
      if (!theme) {
        theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light';
      }
      this._applyTheme(theme);
    },

    _applyTheme: function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      this.theme = theme;
      this.renderer.setTheme(theme);
      GM.store.set(C.KEY_THEME, theme);
    },

    _initSound: function () {
      GM.Sound.enabled = GM.store.get(C.KEY_SOUND, '1') === '1';
      this._syncSoundButton();
    },

    _syncSoundButton: function () {
      $('#btn-sound').classList.toggle('is-off', !GM.Sound.enabled);
      $('#btn-sound').title = GM.Sound.enabled ? '音效：开' : '音效：关';
    },

    _initCoords: function () {
      const on = GM.store.get(C.KEY_COORDS, '1') === '1';
      $('#chk-coords').checked = on;
      this.renderer.setCoords(on);
    },

    _bindTopbar: function () {
      const self = this;
      $('#btn-theme').addEventListener('click', function () {
        self._applyTheme(self.theme === 'dark' ? 'light' : 'dark');
        GM.Sound.play('click');
      });
      $('#btn-sound').addEventListener('click', function () {
        GM.Sound.enabled = !GM.Sound.enabled;
        GM.store.set(C.KEY_SOUND, GM.Sound.enabled ? '1' : '0');
        self._syncSoundButton();
        if (GM.Sound.enabled) GM.Sound.play('click');
      });
    },

    _bindNav: function () {
      $$('[data-nav]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          GM.Views.show(btn.getAttribute('data-nav'));
        });
      });
    },

    /* ================= 网络接入 ================= */

    _initNet: function () {
      const self = this;

      GM.Net.name = GM.store.get(C.KEY_NAME, '');
      GM.Net.ensureSession();

      GM.Net.onMessage = function (msg) { self._onMessage(msg); };
      GM.Net.onState = function (state) { self._onNetState(state); };
    },


    _onNetState: function (state) {
      this._renderBadge(state);
      this._updateConn();

      if (state === 'open') {
        GM.show($('#server-setup'), false);
        if (GM.Views.current === 'lobby') {
          GM.show($('#lobby-main'), true);
          GM.Net.send({ t: MSG.LIST });
        }
      }
      if (state === 'closed' && GM.Views.current !== 'game') {
        this._setText(this._n.connText, '未连接');
      }
    },


    _onMessage: function (msg) {
      if (!msg || !msg.t) return;

      switch (msg.t) {
        case MSG.WELCOME:
          this.me = msg.you || this.me;
          this.rooms = msg.rooms || [];
          this._renderRooms();
          break;

        case MSG.ROOMS:
          this.rooms = msg.list || [];
          this._renderRooms();
          break;

        case MSG.ROOM:
          this._onRoom(msg);
          break;

        case MSG.STATE:
          this._applyState(msg.state);
          break;

        case MSG.REQUEST:
          this._askPermission(msg);
          break;

        case MSG.CHAT:
          this._appendChat(msg.fromColor === this.me.seat ? 'me' : 'peer', msg.text);
          GM.Sound.play('msg');
          if (document.activeElement !== this._n.msgInput) {
            GM.UI.toast(msg.name + '：' + msg.text);
          }
          break;

        case MSG.PEER:
          this._onPeer(msg);
          break;

        case MSG.INFO:
          GM.UI.toast(msg.message);
          break;

        case MSG.ERROR:
          GM.UI.toast(msg.message || '操作失败', 'warn');
          GM.Sound.play('error');
          break;
      }
    },

    _onRoom: function (msg) {
      const you = msg.you || {};
      this.me = you;

      if (!msg.room) {
        /* 已离开房间 */
        this._leavingRoom = false;
        this.model.clear();
        this._renderedMoves = -1;
        this._clearLog();
        this._clearChat();
        this._hideBanner();
        if (GM.Views.current === 'game') GM.Views.show('lobby', true);
        GM.Net.send({ t: MSG.LIST });
        return;
      }

      this._leavingRoom = false;
      this._applyState(msg.room);
    },

    _onPeer: function (msg) {
      const name = msg.name || '对方';
      if (msg.event === 'joined') GM.UI.toast(name + ' 加入了房间');
      else if (msg.event === 'left') GM.UI.toast(name + ' 离开了房间', 'warn');
      else if (msg.event === 'rejoin') GM.UI.toast(name + ' 重新连接上了');
      else if (msg.event === 'spectate') GM.UI.toast(name + ' 进入观战');
    },

    /* ================= 首页 ================= */

    _bindHome: function () {
      const self = this;
      $$('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const act = btn.getAttribute('data-action');
          GM.Sound.play('click');
          if (act === 'lobby') self._openLobby();
          else if (act === 'practice') self._practice();
        });
      });
    },


    /* ================= 大厅 ================= */


    /* ================= 对局：应用权威状态 ================= */

    _applyState: function (state) {
      if (!state) return;

      const firstTime = !this.model.roomId;
      this.model.apply(state);

      if (GM.Views.current !== 'game') {
        GM.Views.show('game', true);
      }

      this.renderer.setModel(this.model);
      this.renderer.draw();

      this._updatePlayers();
      this._updateStats();
      this._updateRoomInfo();
      this._updateBanner();
      this._syncControls();
      this._updateConn();

      if (firstTime) {
        this._clearChat();
        this._renderedMoves = -1;
        const self = this;
        requestAnimationFrame(function () { self._resizeBoard(); });
      }
      this._rebuildLogIfNeeded();
    },

    /* ================= 对局：界面刷新 ================= */


    _updateConn: function () {
      const n = this._n;
      if (!n || !n.connPill) return;

      const m = this.model;
      const inRoom = !!m.roomId;

      if (m.practice) {
        this._setClassName(n.connPill, 'conn-pill is-on');
        this._setText(n.connText, '练习模式');
      } else if (!GM.Net.connected) {
        this._setClassName(n.connPill, 'conn-pill is-off');
        this._setText(n.connText, '未连接');
      } else if (inRoom) {
        const oppSeat = this.me.seat === 1 ? 2 : 1;
        const opp = m.playerOf(oppSeat);
        const on = !!(opp && opp.connected);
        this._setClassName(n.connPill, 'conn-pill ' + (on ? 'is-on' : 'is-warn'));
        this._setText(n.connText, on ? '已连接' : '等待对手');
      } else {
        this._setClassName(n.connPill, 'conn-pill is-on');
        this._setText(n.connText, '已连接服务端');
      }

      this._setClass(n.chatDot, 'is-on', GM.Net.connected && inRoom);
      this._setText(n.chatPeer,
        m.practice ? '练习模式' : (inRoom ? '房间 ' + m.roomId : '未进入房间'));
    },

    _syncControls: function () {
      const n = this._n;
      if (!n) return;

      const m = this.model;
      const inRoom = !!m.roomId;
      const spectator = !m.practice && this.me.seat === 0;

      this._setDisabled(n.btnRestart, !inRoom);
      this._setDisabled(n.btnUndo, !inRoom || spectator || m.moveCount === 0);
      this._setDisabled(n.btnSurrender, !inRoom || spectator || m.ended);

      const canChat = GM.Net.connected && inRoom;
      if (n.msgInput) {
        this._setDisabled(n.msgInput, !canChat);
        const ph = canChat ? '说点什么…' : (inRoom ? '连接已断开' : '进入房间后可聊天');
        if (n.msgInput.placeholder !== ph) n.msgInput.placeholder = ph;
        if (!canChat && n.msgInput.value) n.msgInput.value = '';
      }
      this._setDisabled(n.msgSend, !canChat);
    },

    /* ================= 对局：覆盖层 ================= */


    /* ================= 对局：棋盘交互 ================= */

    _bindBoard: function () {
      const self = this;
      const canvas = $('#board');
      let press = null;

      canvas.addEventListener('pointerdown', function (e) {
        if (!self._canPlay()) return;
        press = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      });

      canvas.addEventListener('pointerup', function (e) {
        const p = press;
        press = null;
        if (!p || p.id !== e.pointerId) return;

        const moved = Math.sqrt(
          Math.pow(e.clientX - p.x, 2) + Math.pow(e.clientY - p.y, 2)
        );
        if (moved > 12 || Date.now() - p.t > 800) return;   // 拖拽 / 长按不算落子

        const point = self.renderer.pointFromEvent(e.clientX, e.clientY);
        if (point) self._sendMove(point.x, point.y);
      });

      canvas.addEventListener('pointercancel', function () { press = null; });

      canvas.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        if (!self._canPlay()) { self.renderer.setHover(null); return; }
        const point = self.renderer.pointFromEvent(e.clientX, e.clientY);
        const color = self.model.practice ? self.model.turn : self.me.seat;
        self.renderer.setHover(point, color);
      });

      canvas.addEventListener('pointerleave', function () {
        self.renderer.setHover(null);
      });

      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    },

    /* 能否落子完全由「服务端状态 + 我的席位」推导，本地不做规则判断 */
    _canPlay: function () {
      if (!GM.Net.connected) return false;
      const m = this.model;
      if (!m.roomId || m.ended || m.status === 'waiting') return false;
      if (m.practice) return true;
      if (this.me.seat === 0) return false;
      return m.turn === this.me.seat;
    },

    _sendMove: function (x, y) {
      const now = Date.now();
      if (now - this._lastMoveAt < C.MOVE_COOLDOWN_MS) return;   // 连点保护
      this._lastMoveAt = now;
      GM.Net.send({ t: MSG.MOVE, x: x, y: y });
    },

    /* ================= 对局：操作 ================= */

    _bindGameView: function () {
      const self = this;

      $('#btn-restart').addEventListener('click', function () { self._restart(); });
      $('#btn-undo').addEventListener('click', function () { self._undo(); });
      $('#btn-surrender').addEventListener('click', function () { self._surrender(); });
      $('#btn-leave').addEventListener('click', function () { self._leaveRoom(); });

      $('#chk-coords').addEventListener('change', function () {
        const on = this.checked;
        self.renderer.setCoords(on);
        GM.store.set(C.KEY_COORDS, on ? '1' : '0');
      });
    },

    _restart: function () {
      if (!this._requireOnline() || !this.model.roomId) return;
      GM.Net.send({ t: MSG.RESTART });
      GM.Sound.play('click');
    },

    _undo: function () {
      if (!this._requireOnline() || !this.model.roomId) return;
      GM.Net.send({ t: MSG.UNDO });
      GM.Sound.play('click');
    },

    _surrender: function () {
      if (!this.model.roomId) return;

      GM.UI.dialog({
        icon: '🏳️', title: '确认认输',
        text: this.model.practice
          ? '练习模式下会直接清空棋盘重新开始，确定吗？'
          : '认输后本局将判对方获胜，确定吗？',
        okText: '认输', cancelText: '再想想', danger: true
      }).then(function (ok) {
        if (!ok) return;
        GM.Net.send({ t: MSG.SURRENDER });
      });
    },

    _leaveRoom: function () {
      const self = this;
      if (!this.model.roomId) {
        GM.Views.show('lobby', true);
        return;
      }

      GM.UI.dialog({
        icon: '🚪', title: '退出房间？',
        text: '退出后本局将结束，需要重新创建或加入房间。',
        okText: '退出', cancelText: '继续对局', danger: true
      }).then(function (ok) {
        if (!ok) return;
        self._leavingRoom = true;
        GM.Net.send({ t: MSG.LEAVE });
      });
    },

    /* 服务端发来的请求：弹窗征求同意 */
    _askPermission: function (msg) {
      const isRestart = msg.kind === 'restart';
      GM.UI.dialog({
        icon: isRestart ? '🔄' : '↩️',
        title: '收到请求',
        text: '「' + (msg.fromName || '对方') + '」请求' +
          (isRestart ? '重新开始这一局' : '悔棋（双方各撤回一步）') + '，是否同意？',
        okText: '同意', cancelText: '拒绝'
      }).then(function (ok) {
        GM.Net.send({ t: MSG.RESPOND, kind: msg.kind, accept: !!ok });
      });
    },

    /* ================= 对局记录 ================= */


    /* ================= 聊天 ================= */


    /* ================= 棋盘尺寸与等高 ================= */

    _bindBoardResize: function () {
      if (this._ro) return;
      const self = this;
      const shell = $('#board-shell');
      if (!shell) return;

      this._onResize = function () { self._resizeBoard(); };
      this._onOrientation = function () {
        clearTimeout(self._orientationTimer);
        self._orientationTimer = setTimeout(function () { self._resizeBoard(); }, 220);
      };

      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(this._onResize);
        this._ro.observe(shell);
      }
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onOrientation);
    },

    _resizeBoard: function () {
      const shell = $('#board-shell');
      if (!shell) return;
      const w = shell.getBoundingClientRect().width;
      if (w <= 0) return;
      this.renderer.layout(w);
      this._syncGridHeight(w);
    },

    _syncGridHeight: function (boardSize) {
      const grid = $('.game-grid');
      if (!grid) return;
      const next = (window.innerWidth <= 1040 || !boardSize)
        ? '' : Math.round(boardSize) + 'px';
      if (grid.style.gridTemplateRows !== next) {
        grid.style.gridTemplateRows = next;
      }
    },

    /* ================= 离开拦截 ================= */

    _initViewGuard: function () {
      const self = this;
      GM.Views.setGuard(function (from, to) {
        if (from !== 'game') return Promise.resolve(true);
        if (!self.model.roomId) return Promise.resolve(true);
        if (self._leavingRoom) return Promise.resolve(true);

        return GM.UI.dialog({
          icon: '🚪', title: '离开对局？',
          text: '离开后本局将结束，需要重新创建或加入房间。',
          okText: '离开', cancelText: '继续对局', danger: true
        }).then(function (ok) {
          if (!ok) return false;
          self._leavingRoom = true;
          GM.Net.send({ t: MSG.LEAVE });
          return true;
        });
      });
    }
  };

  /* 混入拆分出去的模块（聊天 / 大厅 / 对局界面渲染） */
  Object.assign(App, GM.ChatPanel, GM.LobbyPanel, GM.GameView);

  GM.App = App;

  document.addEventListener('DOMContentLoaded', function () { App.init(); });

})(window.GM = window.GM || {});
