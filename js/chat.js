/* ============================================================
   chat.js — 聊天面板：输入、气泡、时间分隔、滚动

   本文件的方法在 app.js 中通过 Object.assign 混入 App，
   拆分只是为了控制单文件规模，不改变调用方式。
   ============================================================ */
(function (GM) {
  'use strict';

  const C = GM.CONFIG;
  const $ = GM.$;
  const MSG = GM.MSG;

  GM.ChatPanel = {
    _bindChat: function () {
      const self = this;
      const input = this._n.msgInput;
      const btn = this._n.msgSend;

      btn.addEventListener('click', function () { self._sendChat(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          self._sendChat(input.value);
        }
      });
      input.addEventListener('input', function () {
        input.classList.remove('is-error');
      });
    },

    _sendChat: function (text) {
      const input = this._n.msgInput;
      const value = String(text == null ? '' : text).trim().slice(0, C.CHAT_MAX_LENGTH);

      if (!GM.Net.connected) { GM.UI.toast('还没有连接到服务端', 'warn'); return; }
      if (!this.model.roomId) { GM.UI.toast('进入房间后才能聊天', 'warn'); return; }
      if (!value) {
        input.classList.add('is-error');
        input.focus();
        GM.UI.toast('请先输入要发送的内容', 'warn');
        return;
      }

      /* 只发给服务端，不在本地抢先渲染。
         服务端确认后会广播回来，届时再上屏 —— 这样客户端看到的
         每一条消息都是服务端认可过的，不会出现「本地有、别人没有」
         的幽灵消息（发完立刻刷新页面就能复现这种不一致）。 */
      GM.Net.send({ t: MSG.CHAT, text: value });

      input.value = '';
      input.classList.remove('is-error');
      input.focus();
    },

    _clearChat: function () {
      const body = this._chatNode();
      if (!body) return;
      const empty = GM.el('div', 'chat-empty');
      empty.appendChild(document.createTextNode('还没有消息'));
      empty.appendChild(GM.el('br'));
      empty.appendChild(document.createTextNode('打个招呼吧'));
      body.replaceChildren(empty);
      this._lastChatAt = 0;
    },

    _chatEmpty: function () {
      const body = this._chatNode();
      const first = body && body.firstElementChild;
      return (first && first.classList.contains('chat-empty')) ? first : null;
    },

    _scrollChat: function () {
      if (this._chatScrollRaf) return;
      const self = this;
      this._chatScrollRaf = requestAnimationFrame(function () {
        self._chatScrollRaf = null;
        const body = self._chatNode();
        if (body) body.scrollTop = body.scrollHeight;
      });
    },

    _chatAtBottom: function () {
      const body = this._chatNode();
      if (!body) return true;
      return body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    },

    _maybeChatTime: function () {
      const body = this._chatNode();
      const now = Date.now();
      if (!this._lastChatAt || now - this._lastChatAt > 5 * 60 * 1000) {
        const d = new Date(now);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        body.appendChild(GM.el('div', 'chat-time', hh + ':' + mm));
      }
      this._lastChatAt = now;
    },

    _appendChat: function (side, text) {
      const body = this._chatNode();
      if (!body) return;

      const stick = this._chatAtBottom();
      const empty = this._chatEmpty();
      if (empty) empty.remove();

      this._maybeChatTime();

      const row = GM.el('div', 'chat-row' + (side === 'me' ? ' is-me' : ''));
      row.appendChild(GM.el('span', 'chat-avatar', side === 'me' ? '我' : '对'));
      row.appendChild(GM.el('div', 'chat-bubble', text));
      body.appendChild(row);

      if (stick || side === 'me') this._scrollChat();
    },

    _chatNode: function () { return this._n.chatBody; },
  };

})(window.GM = window.GM || {});
