/* ============================================================
   gameview.js — 对局界面渲染：玩家卡片、统计、结果浮层、对局记录

   本文件的方法在 app.js 中通过 Object.assign 混入 App，
   拆分只是为了控制单文件规模，不改变调用方式。
   ============================================================ */
(function (GM) {
  'use strict';

  const $ = GM.$;

  GM.GameView = {
    _updatePlayers: function () {
      const n = this._n;
      const m = this.model;
      if (!n || !n.me || !n.op) return;

      const mySeat = this.me.seat || 0;
      const oppSeat = mySeat === 1 ? 2 : 1;

      const meP = m.playerOf(mySeat);
      const opP = m.playerOf(oppSeat);

      if (m.practice) {
        this._setPlayer(n.me, 1, '你', '黑方 · 先手');
        this._setPlayer(n.op, 2, '你', '白方 · 后手');
      } else {
        this._setPlayer(n.me, mySeat || 1,
          meP ? meP.name + '（我）' : '你',
          mySeat === 1 ? '黑方 · 先手' : (mySeat === 2 ? '白方 · 后手' : '观战中'));
        this._setPlayer(n.op, oppSeat,
          opP ? opP.name : '等待加入…',
          oppSeat === 1 ? '黑方 · 先手' : '白方 · 后手');
      }

      const active = (m.ended || m.status === 'waiting') ? 0 : m.turn;
      this._setPlayerState(n.me, m.practice ? 1 : (mySeat || 1), active, m);
      this._setPlayerState(n.op, m.practice ? 2 : oppSeat, active, m);
    },

    _setPlayer: function (p, color, name, colorLabel) {
      if (!p) return;
      const want = String(color);
      if (p.card.getAttribute('data-color') !== want) {
        p.card.setAttribute('data-color', want);
      }
      this._setText(p.name, name);
      this._setText(p.color, colorLabel);
    },

    _setPlayerState: function (p, color, activeColor, m) {
      if (!p) return;
      const isTurn = activeColor === color;
      this._setClass(p.card, 'is-turn', isTurn);
      this._setClass(p.card, 'is-win', m.ended && m.winner === color);

      let label;
      if (m.status === 'waiting') label = '等待中';
      else if (m.ended) label = m.winner === color ? '获胜' : (m.winner === 3 ? '和棋' : '落败');
      else label = isTurn ? '落子中' : '等待中';

      this._setText(p.pill, label);
    },

    _updateStats: function () {
      const m = this.model;
      this._setText(this._n.statMoves, String(m.moveCount));

      let text;
      if (m.status === 'waiting') text = '等待对手';
      else if (m.ended) text = m.winner === 3 ? '和棋' : (m.winner === 1 ? '黑方胜' : '白方胜');
      else text = m.turn === 1 ? '黑方' : '白方';
      this._setText(this._n.statTurn, text);
    },

    _updateRoomInfo: function () {
      const m = this.model;
      this._setText(this._n.roomCode, m.roomId || '—');
      this._setText(this._n.spectateCount, String(m.spectators || 0));
    },

    _updateBanner: function () {
      const m = this.model;

      if (!m.roomId) { this._hideBanner(); return; }

      if (m.status === 'waiting') {
        this._showBanner('⏳', '等待对手加入',
          '把房间号 ' + m.roomId + ' 告诉朋友，让他在大厅里输入即可加入',
          '复制房间号', this._copyRoomCode.bind(this));
        return;
      }

      if (m.ended) {
        const iWin = !m.practice && m.winner === this.me.seat;
        let emoji, title, sub, sound;

        if (m.winner === 3) {
          emoji = '🤝'; title = '和棋'; sub = '棋盘已满，势均力敌'; sound = 'msg';
        } else if (m.practice) {
          emoji = m.winner === 1 ? '⚫' : '⚪';
          title = (m.winner === 1 ? '黑方' : '白方') + '获胜';
          sub = '连成五子'; sound = 'win';
        } else {
          emoji = iWin ? '🎉' : '😵';
          title = iWin ? '你赢了！' : '你输了';
          sub = iWin ? '连成五子，漂亮！' : '对方先连成五子，再来一局？';
          sound = iWin ? 'win' : 'lose';
        }
        GM.Sound.play(sound);
        this._showBanner(emoji, title, sub, '再来一局', this._restart.bind(this));
        return;
      }

      this._hideBanner();
    },

    _showBanner: function (emoji, title, sub, actionText, actionFn) {
      const n = this._n;
      $('#banner-emoji').textContent = emoji || '';
      $('#banner-title').textContent = title || '';
      $('#banner-sub').textContent = sub || '';

      const btn = $('#banner-action');
      if (actionText && actionFn) {
        btn.textContent = actionText;
        btn.hidden = false;
        btn.onclick = actionFn;
      } else {
        btn.hidden = true;
        btn.onclick = null;
      }
      GM.show(n.banner, true);
    },

    _hideBanner: function () {
      GM.show(this._n.banner, false);
    },

    _copyRoomCode: function () {
      const code = this.model.roomId;
      if (!code) return;
      GM.copyText(code).then(function (ok) {
        GM.UI.toast(ok ? '房间号已复制' : '复制失败，请手动记下：' + code, ok ? 'ok' : 'warn');
      });
    },

    _clearLog: function () {
      this._logNode().replaceChildren(GM.el('div', 'log-empty', '暂无记录'));
    },

    _scrollLog: function () {
      if (this._logScrollRaf) return;
      const self = this;
      this._logScrollRaf = requestAnimationFrame(function () {
        self._logScrollRaf = null;
        const log = self._logNode();
        if (log) log.scrollTop = log.scrollHeight;
      });
    },

    /* 只有手数变了才重建，避免每次状态广播都重刷整个列表 */
    _rebuildLogIfNeeded: function () {
      const m = this.model;
      if (m.moveCount === this._renderedMoves) return;
      this._renderedMoves = m.moveCount;

      const log = this._logNode();
      log.replaceChildren();

      if (!m.moves.length) {
        log.appendChild(GM.el('div', 'log-empty', '暂无记录'));
        return;
      }

      const frag = document.createDocumentFragment();
      m.moves.forEach(function (mv, i) {
        const item = GM.el('div', 'log-item');
        item.appendChild(GM.el('span', 'idx', (i + 1) + '.'));
        const dot = GM.el('span');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex-shrink:0;' +
          (mv.c === 1
            ? 'background:#23272f;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)'
            : 'background:#f2f2ee;box-shadow:inset 0 0 0 1px rgba(0,0,0,.22)');
        item.appendChild(dot);
        item.appendChild(GM.el('span', 'coord', GM.coordName(mv.x, mv.y)));
        frag.appendChild(item);
      });
      log.appendChild(frag);
      this._scrollLog();
    },

    _logNode: function () { return this._n.gameLog; },
  };

})(window.GM = window.GM || {});
