/* ============================================================
   lobby.js — 对战大厅：房间列表、创建与加入、连接状态

   本文件的方法在 app.js 中通过 Object.assign 混入 App，
   拆分只是为了控制单文件规模，不改变调用方式。
   ============================================================ */
(function (GM) {
  'use strict';

  const C = GM.CONFIG;
  const $ = GM.$;
  const MSG = GM.MSG;

  GM.LobbyPanel = {
    _bindLobbyView: function () {
      const self = this;

      $('#btn-server-connect').addEventListener('click', function () {
        const status = $('#server-status');
        const url = $('#server-url').value.trim();
        if (!url) {
          GM.setStatus(status, 'err', '请填写服务端地址');
          return;
        }
        if (!/^https?:\/\//i.test(url)) {
          GM.setStatus(status, 'err', '地址要以 http:// 开头，例如 http://192.168.1.5:8080');
          return;
        }
        GM.setStatus(status, 'loading', '正在连接…');
        GM.Net.saveServer(url);
        GM.Net.connect(url);
        setTimeout(function () {
          if (GM.Net.connected) {
            GM.setStatus(status, 'ok', '连接成功');
            GM.show($('#server-setup'), false);
            GM.show($('#lobby-main'), true);
            GM.Net.send({ t: MSG.LIST });
          } else {
            GM.setStatus(status, 'err', '连不上。请确认地址正确、服务端正在运行。');
          }
        }, 1600);
      });

      $('#btn-create-room').addEventListener('click', function () {
        if (!self._requireOnline()) return;
        GM.Net.send({ t: MSG.CREATE, size: C.BOARD_SIZE, win: C.WIN_COUNT });
      });

      $('#btn-refresh-rooms').addEventListener('click', function () {
        if (!self._requireOnline()) return;
        GM.Net.send({ t: MSG.LIST });
      });

      $('#btn-join-code').addEventListener('click', function () { self._joinByCode(); });

      const codeInput = $('#join-code');
      codeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') self._joinByCode();
      });
      codeInput.addEventListener('input', function () {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      });

      const nameInput = this._n.lobbyName;
      nameInput.value = GM.Net.name || '';
      nameInput.addEventListener('change', function () {
        const value = nameInput.value.trim().slice(0, 12)
          || ('玩家' + Math.floor(Math.random() * 90 + 10));
        nameInput.value = value;
        GM.Net.name = value;
        GM.store.set(C.KEY_NAME, value);
        if (GM.Net.connected) {
          GM.Net.send({ t: MSG.HELLO, sessionId: GM.Net.sessionId, name: value });
        }
      });
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') nameInput.blur();
      });
    },

    _lobbyEnter: function () {
      const url = GM.Net.resolveUrl();
      if (!url && !GM.Net.connected) {
        this._showServerSetup();
        $('#server-url').value = GM.store.get(C.KEY_SERVER, '');
        return;
      }
      GM.show($('#server-setup'), false);
      GM.show($('#lobby-main'), true);
      this._renderBadge(GM.Net.connected ? 'open' : 'connecting');
      this._renderRooms();
      if (GM.Net.connected) GM.Net.send({ t: MSG.LIST });
    },

    _requireOnline: function () {
      if (GM.Net.connected) return true;
      GM.UI.toast('还没有连接到服务端', 'warn');
      return false;
    },

    _joinByCode: function () {
      if (!this._requireOnline()) return;
      const code = $('#join-code').value.trim().toUpperCase();
      if (code.length !== 4) {
        GM.UI.toast('房间号是 4 位字母', 'warn');
        return;
      }
      GM.Net.send({ t: MSG.JOIN, room: code });
    },

    _renderRooms: function () {
      const box = this._n.lobbyRooms;
      if (!box) return;

      const self = this;
      const list = this.rooms || [];

      GM.show(this._n.lobbyEmpty, list.length === 0);
      if (!list.length) {
        box.replaceChildren();
        return;
      }

      const frag = document.createDocumentFragment();
      list.forEach(function (room) {
        frag.appendChild(self._buildRoomRow(room));
      });
      box.replaceChildren(frag);
    },

    _buildRoomRow: function (room) {
      const self = this;

      const row = GM.el('div', 'room-item');
      row.appendChild(GM.el('span', 'room-code-tag', room.id));

      const info = GM.el('div', 'room-info');
      const names = (room.players || []).map(function (p) {
        return p.name + (p.connected ? '' : '（掉线）');
      }).join(' vs ');

      info.appendChild(GM.el('strong', null, names || '等待玩家'));
      const bits = [room.size + '×' + room.size];
      if (room.moveCount) bits.push('已下 ' + room.moveCount + ' 手');
      if (room.spectators) bits.push(room.spectators + ' 人观战');
      if (room.practice) bits.push('练习房');
      info.appendChild(GM.el('span', 'room-sub', bits.join(' · ')));
      row.appendChild(info);

      row.appendChild(GM.el('span', 'status-pill ' + this._statusClass(room.status),
        this._statusText(room.status)));

      const actions = GM.el('div', 'room-actions');

      if (room.practice) {
        actions.appendChild(GM.el('span', 'room-hint', '练习房不可加入'));
      } else if (room.status === 'waiting') {
        const join = GM.el('button', 'btn btn-sm btn-primary', '加入');
        join.addEventListener('click', function () {
          if (!self._requireOnline()) return;
          GM.Net.send({ t: MSG.JOIN, room: room.id });
        });
        actions.appendChild(join);
      }

      const watch = GM.el('button', 'btn btn-sm', '观战');
      watch.addEventListener('click', function () {
        if (!self._requireOnline()) return;
        GM.Net.send({ t: MSG.SPECTATE, room: room.id });
      });
      actions.appendChild(watch);

      row.appendChild(actions);
      return row;
    },

    _statusClass: function (status) {
      if (status === 'playing') return 'is-playing';
      if (status === 'ended') return 'is-ended';
      return 'is-idle';
    },

    _statusText: function (status) {
      if (status === 'playing') return '对局中';
      if (status === 'ended') return '已结束';
      return '等待中';
    },

    _showServerSetup: function () {
      GM.show($('#server-setup'), true);
      GM.show($('#lobby-main'), false);
      this._renderBadge('off');
    },

    _renderBadge: function (state) {
      const badge = this._n.lobbyBadge;
      if (!badge) return;
      const text = $('span', badge);
      if (state === 'open') {
        badge.className = 'lobby-badge is-on';
        text.textContent = '已连接';
      } else if (state === 'connecting') {
        badge.className = 'lobby-badge';
        text.textContent = '连接中…';
      } else {
        badge.className = 'lobby-badge is-off';
        text.textContent = '未连接';
      }
    },

    _openLobby: function () {
      GM.Views.show('lobby');
    },

    _practice: function () {
      if (!GM.Net.connected) {
        GM.UI.toast('还没有连接到服务端', 'warn');
        return;
      }
      GM.Net.send({ t: MSG.PRACTICE, size: C.BOARD_SIZE, win: C.WIN_COUNT });
    },

    /* 由服务端托管时自动连上；用 file:// 打开则先提示填地址 */
    _tryAutoConnect: function () {
      const url = GM.Net.resolveUrl();
      if (url) {
        GM.Net.connect(url);
      } else {
        this._showServerSetup();
      }
    },
  };

})(window.GM = window.GM || {});
