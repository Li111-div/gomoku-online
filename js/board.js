/* ============================================================
   board.js — 棋盘视图模型

   注意：这里**没有任何棋局规则**。

   落子是否合法、谁连成了五子、能不能悔棋 —— 全部由服务端判定。
   这个对象只是「服务端权威状态的一个投影」，客户端拿到什么就显示什么。
   这样做的好处是：客户端永远不可能和服务端算出不一样的结果。
   ============================================================ */
(function (GM) {
  'use strict';

  function Board() {
    this.size = 15;
    this.cells = [];          // 扁平数组，cells[y * size + x]
    this.turn = 0;
    this.winner = 0;          // 0=未结束 1=黑 2=白 3=和棋
    this.ended = false;
    this.winLine = null;      // [[x, y], ...]
    this.moves = [];          // [{x, y, c}, ...]
    this.moveCount = 0;

    /* 房间相关 */
    this.roomId = '';
    this.status = 'waiting';  // waiting | playing | ended
    this.practice = false;
    this.players = [];        // [{color, name, connected}]
    this.spectators = 0;
    this.pending = null;      // {kind, from} 待处理的请求
  }

  Board.prototype = {

    /* ---------- 用服务端下发的完整快照覆盖本地状态 ---------- */
    apply: function (state) {
      if (!state) return;

      const g = state.game || {};

      this.size = g.size || this.size;
      this.cells = g.board || [];
      this.turn = g.turn || 0;
      this.winner = g.winner || 0;
      this.ended = !!g.ended;
      this.winLine = g.winLine || null;
      this.moveCount = g.moveCount || 0;
      this.moves = (g.moves || []).map(function (m) {
        return { x: m[0], y: m[1], c: m[2] };
      });

      this.roomId = state.room || '';
      this.status = state.status || 'waiting';
      this.practice = !!state.practice;
      this.players = state.players || [];
      this.spectators = state.spectators || 0;
      this.pending = state.pending || null;
    },

    /* ---------- 清空（离开房间时） ---------- */
    clear: function () {
      this.size = 15;
      this.cells = [];
      this.turn = 0;
      this.winner = 0;
      this.ended = false;
      this.winLine = null;
      this.moves = [];
      this.moveCount = 0;
      this.roomId = '';
      this.status = 'waiting';
      this.practice = false;
      this.players = [];
      this.spectators = 0;
      this.pending = null;
    },

    /* ---------- 查询（渲染层用） ---------- */

    inside: function (x, y) {
      return x >= 0 && y >= 0 && x < this.size && y < this.size;
    },

    at: function (x, y) {
      if (!this.inside(x, y)) return -1;
      const v = this.cells[y * this.size + x];
      return v === undefined ? 0 : v;
    },

    lastMove: function () {
      return this.moves.length ? this.moves[this.moves.length - 1] : null;
    },

    /* ---------- 房间信息 ---------- */

    playerOf: function (color) {
      for (let i = 0; i < this.players.length; i++) {
        if (this.players[i].color === color) return this.players[i];
      }
      return null;
    },

    isSeated: function () {
      return this.status === 'playing' || this.status === 'ended'
        || this.players.length > 0;
    }
  };

  GM.Board = Board;

})(window.GM = window.GM || {});
