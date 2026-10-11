/**
 * 浏览器端到端测试
 *
 * 会自己启动服务端、跑完测试、再关掉，因此可以在 CI 里直接运行。
 *
 * 依赖 Playwright（仅开发依赖，不是运行时依赖）：
 *     npm install -D playwright
 *     npx playwright install chromium
 *
 * 运行：
 *     node tests/e2e.mjs              # 无头模式
 *     node tests/e2e.mjs --headed     # 显示浏览器窗口，便于排查
 *     PORT=9000 node tests/e2e.mjs    # 指定端口
 */

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('\n  找不到 Playwright。请先安装：');
  console.error('      npm install -D playwright');
  console.error('      npx playwright install chromium\n');
  process.exit(2);
}

/* ---------------------------------------------------------------- 断言 */

let passed = 0;
let failed = 0;

function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : ''));
  }
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

/* ---------------------------------------------------------------- 工具 */

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('服务端启动超时'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function startServer() {
  /* Windows 上通常只有 python，Linux / macOS 上是 python3 */
  const python = process.env.PYTHON
    || (process.platform === 'win32' ? 'python' : 'python3');

  const proc = spawn(
    python,
    [path.join('server', 'server.py'), String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  proc.on('error', (err) => {
    console.error(`\n  无法启动服务端（${python}）：${err.message}`);
    console.error('  请确认已安装 Python 3.7+，或用 PYTHON 环境变量指定解释器。\n');
  });
  return proc;
}

function watch(page, bucket) {
  page.on('pageerror', (e) => bucket.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') bucket.push('CONSOLE: ' + m.text()); });
}

async function newClient(browser, width = 1360, height = 940) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE);
  await page.waitForFunction(() => window.GM && window.GM.Net && window.GM.Net.connected,
    { timeout: 20000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

async function tap(page, gx, gy) {
  const point = await page.evaluate((g) => {
    const r = window.GM.App.renderer;
    const rect = document.querySelector('#board').getBoundingClientRect();
    const scale = rect.width / r.size;
    return { x: rect.left + r.toPx(g[0]) * scale, y: rect.top + r.toPx(g[1]) * scale };
  }, [gx, gy]);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(160);
}

function state(page) {
  return page.evaluate(() => {
    const m = window.GM.App.model;
    return {
      room: m.roomId, status: m.status, moves: m.moveCount,
      turn: m.turn, winner: m.winner, ended: m.ended,
      seat: window.GM.App.me.seat, spectators: m.spectators,
      players: m.players.map((p) => `${p.name}:${p.color}`)
    };
  });
}

async function setName(page, name) {
  await page.fill('#lobby-name', name);
  await page.press('#lobby-name', 'Enter');
  await page.waitForTimeout(250);
}

/* ---------------------------------------------------------------- 主流程 */

const server = startServer();
let browser;
let exitCode = 0;

try {
  await waitForPort(PORT);
  console.log(`\n服务端已就绪：${BASE}`);

  browser = await chromium.launch({ headless: !HEADED });

  /* ---------------- A. 连接与大厅 ---------------- */

  section('A. 连接与大厅');
  const A = await newClient(browser);
  ok('页面加载无 JS 报错', A.errors.length === 0, A.errors.join(' | '));
  ok('WebSocket 自动连接成功', await A.page.evaluate(() => window.GM.Net.connected));
  ok('大厅徽章显示已连接',
    (await A.page.getAttribute('#lobby-badge', 'class')).includes('is-on'));

  await A.page.click('[data-nav="lobby"]');
  await A.page.waitForTimeout(400);
  await setName(A.page, '张三');
  await A.page.click('#btn-create-room');
  await A.page.waitForSelector('#view-game.is-active', { timeout: 15000 });
  await A.page.waitForTimeout(600);

  let sa = await state(A.page);
  ok('创建房间后进入对局界面', /^[A-Z]{4}$/.test(sa.room), sa.room);
  ok('房主执黑先手', sa.seat === 1, sa.seat);
  ok('初始状态为等待对手', sa.status === 'waiting', sa.status);
  ok('等待提示浮层已显示', await A.page.locator('#board-banner').isVisible());

  const ROOM = sa.room;

  /* ---------------- B. 加入与对局 ---------------- */

  section('B. 加入与对局');
  const B = await newClient(browser);
  await B.page.click('[data-nav="lobby"]');
  await B.page.waitForTimeout(400);
  await setName(B.page, '李四');
  await B.page.waitForSelector('#lobby-rooms .room-item', { timeout: 15000 });

  const roomText = await B.page.locator('#lobby-rooms .room-item').first().textContent();
  ok('大厅能看到刚创建的房间', roomText.includes(ROOM), roomText);
  ok('房间显示房主名字', roomText.includes('张三'), roomText);

  await B.page.fill('#join-code', ROOM);
  await B.page.click('#btn-join-code');
  await B.page.waitForSelector('#view-game.is-active', { timeout: 15000 });
  await A.page.waitForTimeout(900);

  const sA = await state(A.page);
  const sB = await state(B.page);
  ok('房主状态变为对局中', sA.status === 'playing', sA.status);
  ok('加入者执白后手', sB.seat === 2, sB.seat);
  ok('双方玩家列表一致', sA.players.join() === sB.players.join(), sA.players.join());
  ok('人齐后浮层已隐藏', !(await A.page.locator('#board-banner').isVisible()));

  await tap(A.page, 7, 7);
  await B.page.waitForTimeout(500);
  ok('黑方落子同步到白方', (await state(B.page)).moves === 1);
  ok('白方棋盘出现黑子',
    (await B.page.evaluate(() => window.GM.App.model.at(7, 7))) === 1);

  await tap(B.page, 8, 8);
  await A.page.waitForTimeout(500);
  ok('白方落子同步到黑方', (await state(A.page)).moves === 2);
  ok('轮次交回黑方', (await state(A.page)).turn === 1);

  /* ---------------- C. 服务端权威性 ---------------- */

  section('C. 服务端权威性');
  const before = (await state(A.page)).moves;

  await B.page.evaluate(() => window.GM.Net.send({ t: 'move', x: 5, y: 5 }));
  await B.page.waitForTimeout(500);
  ok('非本方回合落子被服务端拒绝', (await state(B.page)).moves === before);

  await A.page.evaluate(() => window.GM.Net.send({ t: 'move', x: 7, y: 7 }));
  await A.page.waitForTimeout(500);
  ok('落在已有棋子处被拒绝', (await state(A.page)).moves === before);

  await A.page.evaluate(() => window.GM.Net.send({ t: 'move', x: 99, y: -3 }));
  await A.page.waitForTimeout(500);
  ok('越界坐标被拒绝', (await state(A.page)).moves === before);

  await A.page.evaluate(() => window.GM.Net.send({ t: 'move', x: 'a', y: null }));
  await A.page.waitForTimeout(500);
  ok('非法类型坐标被拒绝', (await state(A.page)).moves === before);

  const tampered = await A.page.evaluate(() => {
    window.GM.App.model.cells[0] = 1;      // 偷偷塞一颗黑子到 (0,0)
    window.GM.App.model.moveCount = 999;
    window.GM.App.renderer.draw();
    return window.GM.App.model.at(0, 0);
  });
  ok('本地状态确实被篡改', tampered === 1);

  await tap(A.page, 5, 5);                 // 走一步合法棋，触发服务端广播
  await A.page.waitForTimeout(600);
  ok('篡改的格子被服务端状态覆盖',
    (await A.page.evaluate(() => window.GM.App.model.at(0, 0))) === 0);
  ok('篡改的手数被服务端状态覆盖',
    (await A.page.evaluate(() => window.GM.App.model.moveCount)) < 999);

  await tap(B.page, 9, 9);
  await A.page.waitForTimeout(450);
  await tap(A.page, 3, 3);
  await A.page.waitForTimeout(450);
  ok('合法落子正常生效',
    (await state(A.page)).moves === (await state(B.page)).moves);

  /* ---------------- D. 多房间并行隔离 ---------------- */

  section('D. 多房间并行');
  const movesBeforeD = (await state(A.page)).moves;

  const C = await newClient(browser);
  const D = await newClient(browser);
  await C.page.click('[data-nav="lobby"]');
  await setName(C.page, '王五');
  await C.page.click('#btn-create-room');
  await C.page.waitForSelector('#view-game.is-active', { timeout: 15000 });
  const roomC = (await state(C.page)).room;

  await D.page.click('[data-nav="lobby"]');
  await setName(D.page, '赵六');
  await D.page.fill('#join-code', roomC);
  await D.page.click('#btn-join-code');
  await D.page.waitForSelector('#view-game.is-active', { timeout: 15000 });
  await C.page.waitForTimeout(800);

  ok('第二个房间独立创建', roomC !== ROOM, `${roomC} vs ${ROOM}`);
  ok('第二局状态独立', (await state(C.page)).status === 'playing');

  await tap(C.page, 10, 10);
  await D.page.waitForTimeout(500);
  ok('第二局落子同步正常', (await state(D.page)).moves === 1);
  ok('第一局棋盘未受影响',
    (await A.page.evaluate(() => window.GM.App.model.at(10, 10))) === 0);
  ok('第一局手数未变', (await state(A.page)).moves === movesBeforeD);

  /* ---------------- E. 观战 ---------------- */

  section('E. 观战');
  const E = await newClient(browser);
  await E.page.click('[data-nav="lobby"]');
  await setName(E.page, '旁观者');
  await E.page.waitForSelector('#lobby-rooms .room-item', { timeout: 15000 });

  await E.page.locator('.room-item', { hasText: ROOM })
    .locator('button', { hasText: '观战' }).click();
  await E.page.waitForSelector('#view-game.is-active', { timeout: 15000 });
  await E.page.waitForTimeout(800);

  const sE = await state(E.page);
  ok('观战者进入对局界面', sE.room === ROOM, sE.room);
  ok('观战者没有席位', sE.seat === 0, sE.seat);
  ok('观战者能看到当前手数', sE.moves === (await state(A.page)).moves);
  ok('房间统计显示观战人数', sE.spectators >= 1, sE.spectators);

  const eMoves = sE.moves;
  await tap(E.page, 1, 1);
  await E.page.waitForTimeout(500);
  ok('观战者落子被拒绝', (await state(E.page)).moves === eMoves);

  /* ---------------- F. 请求需双方同意 ---------------- */

  section('F. 重开与悔棋需双方同意');
  await A.page.click('#btn-restart');
  await B.page.waitForSelector('#modal-host:not([hidden])', { timeout: 10000 });
  const reqText = await B.page.locator('#modal-text').textContent();
  ok('对方收到重开请求弹窗', reqText.includes('张三'), reqText);

  await B.page.locator('#modal-actions button').last().click();
  await A.page.waitForTimeout(900);
  ok('同意后双方棋盘清空',
    (await state(A.page)).moves === 0 && (await state(B.page)).moves === 0);
  ok('观战者也同步看到清空', (await state(E.page)).moves === 0);

  await tap(A.page, 7, 7);
  await B.page.waitForTimeout(450);
  await tap(B.page, 8, 8);
  await A.page.waitForTimeout(500);
  await A.page.click('#btn-undo');
  await B.page.waitForSelector('#modal-host:not([hidden])', { timeout: 10000 });
  await B.page.locator('#modal-actions button').first().click();      // 拒绝
  await A.page.waitForTimeout(900);
  ok('拒绝悔棋后棋盘不变', (await state(A.page)).moves === 2,
    (await state(A.page)).moves);

  /* ---------------- G. 聊天 ---------------- */

  section('G. 聊天');
  await A.page.fill('#msg-input', '你好，这局有意思');
  await A.page.press('#msg-input', 'Enter');
  await A.page.waitForTimeout(700);
  await B.page.waitForTimeout(400);

  const mineRows = await A.page.locator('#chat-body .chat-row').count();
  const peerRows = await B.page.locator('#chat-body .chat-row').count();
  ok('发送方自己只看到一条（不会被服务端回声重复渲染）', mineRows === 1, mineRows);
  ok('接收方看到一条', peerRows === 1, peerRows);
  ok('自己侧气泡靠右',
    (await A.page.getAttribute('#chat-body .chat-row', 'class')).includes('is-me'));
  ok('对方侧气泡靠左',
    !(await B.page.getAttribute('#chat-body .chat-row', 'class')).includes('is-me'));

  await A.page.evaluate(() => window.GM.App._sendChat('A'.repeat(500)));
  await A.page.waitForTimeout(600);
  const longLen = await A.page.evaluate(() => {
    const rows = document.querySelectorAll('#chat-body .chat-row');
    return rows[rows.length - 1].querySelector('.chat-bubble').textContent.length;
  });
  ok('超长消息被裁剪到 60 字', longLen === 60, longLen);

  /* ---------------- H. 断线重连 ---------------- */

  section('H. 断线重连');
  const beforeReload = await state(A.page);
  await A.page.reload();
  await A.page.waitForFunction(() => window.GM && window.GM.Net && window.GM.Net.connected,
    { timeout: 20000 });
  await A.page.waitForTimeout(1500);

  const afterReload = await state(A.page);
  ok('刷新后自动重连回原房间', afterReload.room === beforeReload.room,
    `${afterReload.room} vs ${beforeReload.room}`);
  ok('刷新后仍保留黑方席位', afterReload.seat === 1, afterReload.seat);
  ok('刷新后棋局完整恢复', afterReload.moves === beforeReload.moves,
    `${afterReload.moves} vs ${beforeReload.moves}`);
  ok('刷新后自动回到对局界面',
    (await A.page.locator('#view-game.is-active').count()) === 1);

  /* ---------------- I. 布局与响应式 ---------------- */

  section('I. 布局与响应式');
  await A.page.waitForTimeout(600);
  const align = await A.page.evaluate(() => {
    const bottom = (s) => document.querySelector(s).getBoundingClientRect().bottom;
    return { board: bottom('#board-shell'), left: bottom('.col-players'), right: bottom('.col-side') };
  });
  ok('三栏底部与棋盘齐平',
    Math.abs(align.left - align.board) < 2 && Math.abs(align.right - align.board) < 2,
    JSON.stringify(align));

  for (const size of [{ n: '平板 1024', w: 1024, h: 820 },
                      { n: '手机 390', w: 390, h: 844 }]) {
    const client = await newClient(browser, size.w, size.h);
    const overflow = await client.page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    ok(`${size.n}：无横向滚动`, overflow <= 1, 'overflow=' + overflow);
    ok(`${size.n}：无 JS 报错`, client.errors.length === 0, client.errors.join(' | '));
    await client.ctx.close();
  }

  /* ---------------- J. 无报错 ---------------- */

  section('J. 运行期无报错');
  for (const [label, client] of [['张三', A], ['李四', B], ['王五', C],
                                 ['赵六', D], ['旁观者', E]]) {
    ok(`${label}无报错`, client.errors.length === 0, client.errors.join(' | '));
  }

} catch (err) {
  console.error('\n测试脚本异常：' + err.message);
  exitCode = 2;
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log('\n' + '='.repeat(44));
console.log(`  通过 ${passed} 项，失败 ${failed} 项`);
console.log('='.repeat(44) + '\n');

process.exit(exitCode || (failed ? 1 : 0));
