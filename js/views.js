/* ============================================================
   views.js — 多界面路由（单页应用，无需刷新）
   ============================================================ */
(function (GM) {
  'use strict';

  const VIEWS = ['home', 'lobby', 'game', 'help'];

  const Views = {
    current: 'home',
    _guard: null,       // 离开视图前的拦截函数 (from, to) => Promise<bool>
    onChange: null,     // 视图切换后的通知 (name) => void

    /* 注册离开拦截（例如对局中确认退出） */
    setGuard: function (fn) { this._guard = fn; },

    /* 切换视图 */
    show: function (name, force) {
      const self = this;
      if (VIEWS.indexOf(name) < 0) name = 'home';

      const proceed = function () {
        self.current = name;

        GM.$$('.view').forEach(function (v) {
          v.classList.toggle('is-active', v.id === 'view-' + name);
        });

        GM.$$('.navlink').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-nav') === name);
        });

        /* 切到新视图时滚回顶部 */
        window.scrollTo({ top: 0, behavior: 'smooth' });

        /* 通知外部做视图相关的启停（例如大厅轮询） */
        if (self.onChange) self.onChange(name);
      };

      if (!force && this._guard && name !== this.current) {
        Promise.resolve(this._guard(this.current, name)).then(function (ok) {
          if (ok) proceed();
        });
        return;
      }
      proceed();
    },

    /* 是否处于对局界面 */
    inGame: function () { return this.current === 'game'; }
  };

  GM.Views = Views;

})(window.GM = window.GM || {});
