/* ============================================================
   renderer.js — Canvas 棋盘渲染与点击坐标换算
   ============================================================ */
(function (GM) {
  'use strict';

  function Renderer(canvas, model) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.model = model;

    this.theme = 'light';
    this.showCoords = true;
    this.hover = null;        // {x, y} 悬停预览
    this.hoverColor = 1;

    this.size = 0;            // 逻辑边长（CSS 像素）
    this.margin = 0;          // 棋盘内边距
    this.cell = 0;            // 格距
    this.dpr = 1;

    this._raf = null;
    this._bg = null;          // 木纹底色的离屏缓存
    this._bgKey = '';         // 缓存键：尺寸 + 主题 + 像素比
  }

  Renderer.prototype = {

    /* ---------- 尺寸与高清适配 ----------
       由外部传入容器的 CSS 尺寸；内部按 devicePixelRatio 放大画布，
       再把坐标系统缩放回来，避免高分屏发虚。 */
    layout: function (cssSize) {
      if (!cssSize || cssSize <= 0) return;
      const n = this.model.size;

      this.size = cssSize;
      this.margin = Math.max(14, Math.round(cssSize * 0.058));
      this.cell = (cssSize - this.margin * 2) / (n - 1);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      const px = Math.round(cssSize * this.dpr);
      this.canvas.width = px;
      this.canvas.height = px;
      this.canvas.style.width = cssSize + 'px';
      this.canvas.style.height = cssSize + 'px';

      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.draw();
    },

    setModel: function (model) { this.model = model; this.draw(); },
    setTheme: function (theme) { this.theme = theme; this.draw(); },
    setCoords: function (v) { this.showCoords = v; this.draw(); },

    setHover: function (point, color) {
      const same = (this.hover === point) ||
        (this.hover && point && this.hover.x === point.x && this.hover.y === point.y);
      if (same) return;
      this.hover = point;
      if (color) this.hoverColor = color;
      this.draw();
    },

    /* ---------- 格坐标 → 像素中心 ---------- */
    toPx: function (i) { return this.margin + i * this.cell; },

    /* ---------- 事件坐标 → 格坐标（含 CSS 缩放校正） ----------
       返回 {x, y} 或 null */
    pointFromEvent: function (clientX, clientY) {
      /* 尚未 layout 时尺寸为 0，直接拒绝，避免坐标换算得到无意义结果 */
      if (!this.size || !this.cell) return null;

      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      // 关键：把显示尺寸换算回逻辑尺寸，防止 CSS 缩放导致落点偏移
      const scaleX = this.size / rect.width;
      const scaleY = this.size / rect.height;
      const lx = (clientX - rect.left) * scaleX;
      const ly = (clientY - rect.top) * scaleY;

      const gx = Math.round((lx - this.margin) / this.cell);
      const gy = Math.round((ly - this.margin) / this.cell);

      if (!this.model.inside(gx, gy)) return null;

      // 距离交叉点太远的点击忽略掉，避免误触
      const dx = lx - this.toPx(gx);
      const dy = ly - this.toPx(gy);
      if (Math.sqrt(dx * dx + dy * dy) > this.cell * 0.66) return null;

      return { x: gx, y: gy };
    },

    /* ---------- 调度绘制 ---------- */
    draw: function () {
      if (this._raf) return;
      const self = this;
      this._raf = requestAnimationFrame(function () {
        self._raf = null;
        self._render();
      });
    },

    /* ---------- 预渲染木纹底色到离屏 canvas ----------
       仅在棋盘尺寸、主题或像素比变化时重建。 */
    _buildBackground: function () {
      const S = this.size;
      const T = GM.BOARD_THEMES[this.theme] || GM.BOARD_THEMES.light;
      const dpr = this.dpr;
      const px = Math.max(1, Math.round(S * dpr));

      const cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;

      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* 底色渐变 */
      const grad = ctx.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, T.bgFrom);
      grad.addColorStop(1, T.bgTo);
      ctx.fillStyle = grad;
      this._roundRect(ctx, 0, 0, S, S, Math.max(10, S * 0.022));
      ctx.fill();

      /* 木纹肌理 */
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = T.grain;
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const y = (i / 26) * S + ((i * 37) % 11) * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(S * 0.3, y + 6, S * 0.66, y - 6, S, y + 3);
        ctx.stroke();
      }
      ctx.restore();

      this._bg = cv;
      this._bgKey = S + '|' + this.theme + '|' + dpr;
    },

    /* ---------- 主绘制 ---------- */
    _render: function () {
      const ctx = this.ctx;
      const S = this.size;
      const n = this.model.size;
      const T = GM.BOARD_THEMES[this.theme] || GM.BOARD_THEMES.light;

      ctx.clearRect(0, 0, S, S);

      /* 木纹底色与肌理是纯静态内容，复用离屏缓存，避免每帧重画 26 条曲线 */
      const bgKey = S + '|' + this.theme + '|' + this.dpr;
      if (!this._bg || this._bgKey !== bgKey) this._buildBackground();
      ctx.drawImage(this._bg, 0, 0, S, S);

      /* 网格线 */
      ctx.strokeStyle = T.line;
      ctx.lineWidth = Math.max(1, S / 640);
      for (let i = 0; i < n; i++) {
        const p = this.toPx(i);
        ctx.beginPath();
        ctx.moveTo(this.toPx(0), p);
        ctx.lineTo(this.toPx(n - 1), p);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p, this.toPx(0));
        ctx.lineTo(p, this.toPx(n - 1));
        ctx.stroke();
      }

      /* 外框加粗 */
      ctx.strokeStyle = T.border;
      ctx.lineWidth = Math.max(1.4, S / 400);
      ctx.strokeRect(
        this.toPx(0), this.toPx(0),
        this.toPx(n - 1) - this.toPx(0),
        this.toPx(n - 1) - this.toPx(0)
      );

      /* 星位 */
      const starR = Math.max(2.2, S * 0.0052);
      ctx.fillStyle = T.star;
      GM.CONFIG.STARS.forEach(function (p) {
        if (p[0] >= n || p[1] >= n) return;
        ctx.beginPath();
        ctx.arc(this.toPx(p[0]), this.toPx(p[1]), starR, 0, Math.PI * 2);
        ctx.fill();
      }, this);

      /* 坐标标注 */
      if (this.showCoords) this._drawCoords(T);

      /* 棋子 */
      const stones = this.model.moves;
      for (let i = 0; i < stones.length; i++) {
        this._drawStone(stones[i].x, stones[i].y, stones[i].c, 1);
      }

      /* 悬停预览 */
      if (this.hover && !this.model.ended && this.model.at(this.hover.x, this.hover.y) === 0) {
        this._drawStone(this.hover.x, this.hover.y, this.hoverColor, 0.34);
      }

      /* 最后一手标记 */
      const last = this.model.lastMove();
      if (last && !this.model.ended) {
        this._drawLastMark(last.x, last.y, last.c, T);
      }

      /* 获胜连线高亮 */
      if (this.model.winLine && this.model.winLine.length) {
        this._drawWinLine(T);
      }
    },

    /* ---------- 坐标标注 ---------- */
    _drawCoords: function (T) {
      const ctx = this.ctx;
      const n = this.model.size;
      const S = this.size;
      const fs = Math.max(9, S * 0.019);

      ctx.save();
      ctx.fillStyle = T.coord;
      ctx.font = '500 ' + fs.toFixed(1) + 'px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const off = this.margin * 0.46;

      for (let i = 0; i < n; i++) {
        const p = this.toPx(i);
        ctx.fillText(String.fromCharCode(65 + i), p, off * 0.95);          // 上：字母
        ctx.fillText(String(i + 1), off * 0.95, p);                        // 左：数字
      }
      ctx.restore();
    },

    /* ---------- 单颗棋子 ---------- */
    _drawStone: function (x, y, color, alpha) {
      const ctx = this.ctx;
      const r = this.cell * 0.435;
      const cx = this.toPx(x);
      const cy = this.toPx(y);

      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;

      /* 投影 */
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.14, r * 0.98, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
      ctx.filter = 'blur(' + (r * 0.16).toFixed(1) + 'px)';
      ctx.fill();
      ctx.filter = 'none';

      /* 主体：径向渐变营造立体感 */
      const g = ctx.createRadialGradient(
        cx - r * 0.34, cy - r * 0.38, r * 0.08,
        cx, cy, r * 1.06
      );
      if (color === 1) {
        g.addColorStop(0, '#6b7383');
        g.addColorStop(0.42, '#2b3040');
        g.addColorStop(1, '#0e1118');
      } else {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.55, '#f4f4f0');
        g.addColorStop(1, '#cbcbc4');
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      /* 描边 */
      ctx.lineWidth = Math.max(0.6, this.size / 900);
      ctx.strokeStyle = color === 1
        ? 'rgba(255, 255, 255, 0.10)'
        : 'rgba(60, 60, 60, 0.18)';
      ctx.stroke();

      /* 高光点 */
      if (color === 1 && alpha === 1) {
        const hl = ctx.createRadialGradient(
          cx - r * 0.36, cy - r * 0.42, 0,
          cx - r * 0.36, cy - r * 0.42, r * 0.55
        );
        hl.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
        hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = hl;
        ctx.fill();
      }

      ctx.restore();
    },

    /* ---------- 最后一手标记 ---------- */
    _drawLastMark: function (x, y, color, T) {
      const ctx = this.ctx;
      const r = this.cell * 0.435;
      const cx = this.toPx(x);
      const cy = this.toPx(y);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = color === 1 ? T.markOnDark : T.markOnLight;
      ctx.fill();
      ctx.restore();
    },

    /* ---------- 获胜连线 ---------- */
    _drawWinLine: function (T) {
      const ctx = this.ctx;
      const line = this.model.winLine;
      const r = this.cell * 0.435;

      const a = line[0];
      const b = line[line.length - 1];

      ctx.save();

      /* 半透明连线 */
      ctx.beginPath();
      ctx.moveTo(this.toPx(a[0]), this.toPx(a[1]));
      ctx.lineTo(this.toPx(b[0]), this.toPx(b[1]));
      ctx.strokeStyle = T.winGlow;
      ctx.lineWidth = this.cell * 0.62;
      ctx.lineCap = 'round';
      ctx.stroke();

      /* 每颗获胜棋子加光环 */
      ctx.strokeStyle = T.winRing;
      ctx.lineWidth = Math.max(2, this.size / 230);
      for (let i = 0; i < line.length; i++) {
        ctx.beginPath();
        ctx.arc(this.toPx(line[i][0]), this.toPx(line[i][1]), r * 1.14, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    },

    /* ---------- 圆角矩形路径（可作用于任意 2D 上下文） ---------- */
    _roundRect: function (ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  };

  GM.Renderer = Renderer;

})(window.GM = window.GM || {});
