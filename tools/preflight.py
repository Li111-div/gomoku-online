#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
preflight.py — 提交前自动化门禁

在人工审查之前，把所有「机器能判断」的问题挡掉。
这样审查者可以把注意力放在设计、逻辑、可维护性这些真正需要人判断的地方。

检查项：
  1. 语法            JS 用 node --check，Python 用 py_compile
  2. 协议常量同步      js/config.js 的 GM.MSG ↔ server/protocol.py
  3. 禁用模式         var / debugger / innerHTML 拼接 / console.log / TODO
  4. DOM 引用完整性   JS 里选择器引用的 id 必须真实存在于 HTML
  5. 架构不变量       客户端 js/ 下不得出现任何棋局规则
  6. 零依赖           服务端只允许 import 标准库与同目录模块
  7. 文件规模         超过阈值提示拆分
  8. 未引用文件       js/ 下的文件必须被 index.html 加载

退出码：0 = 通过，1 = 存在 ERROR

用法：
    python tools/preflight.py            # 全部检查
    python tools/preflight.py --quiet    # 只输出问题
"""

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, 'js')
SERVER_DIR = os.path.join(ROOT, 'server')
STYLE_DIR = os.path.join(ROOT, 'styles')
TOOLS_DIR = os.path.join(ROOT, 'tools')
TESTS_DIR = os.path.join(ROOT, 'tests')
INDEX = os.path.join(ROOT, 'index.html')

# 所有需要做语法检查的 Python 目录
PY_DIRS = (SERVER_DIR, TOOLS_DIR, TESTS_DIR)

# 文件规模阈值。
# 逻辑文件与声明式文件分开设：一行 CSS 只是一条声明，一行 JS 通常是一段逻辑，
# 用同一个数字衡量不合理。阈值存在的意义是提示「职责可能没拆开」，
# 而不是为了凑一个好看的数字 —— 超标了要么拆，要么在评审里说明理由。
MAX_LINES = {
    'logic': 800,      # .js / .py
    'style': 1200,     # .css
}

# 服务端允许的本地模块（同目录）
LOCAL_MODULES = {'gomoku', 'protocol', 'rooms', 'ws', 'server'}


class Report(object):
    def __init__(self):
        self.errors = []
        self.warns = []
        self.checks = 0

    def error(self, check, message, where=''):
        self.errors.append((check, message, where))

    def warn(self, check, message, where=''):
        self.warns.append((check, message, where))

    @property
    def ok(self):
        return not self.errors


# ---------------------------------------------------------------- 工具


def read(path):
    try:
        with open(path, 'r', encoding='utf-8') as fp:
            return fp.read()
    except (OSError, UnicodeDecodeError):
        return ''


def walk(folder, exts):
    out = []
    for base, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for name in files:
            if os.path.splitext(name)[1] in exts:
                out.append(os.path.join(base, name))
    return sorted(out)


def rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def find_node():
    for name in ('node', 'node.exe'):
        found = shutil.which(name)
        if found:
            return found
    return None


# ---------------------------------------------------------------- 检查


def check_syntax(rep):
    """1. 语法：语法错误是绝对红线，必须零容忍"""
    name = '语法'
    rep.checks += 1

    node = find_node()
    if node is None:
        rep.warn(name, '未找到 node，跳过 JS 语法检查（请安装 Node.js 或把它加入 PATH）')

    for path in walk(JS_DIR, {'.js'}):
        if node is None:
            break
        proc = subprocess.run([node, '--check', path],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            detail = (proc.stderr or '').strip().split('\n')
            rep.error(name, detail[0] if detail else '语法错误', rel(path))

    for folder in PY_DIRS:
        for path in walk(folder, {'.py'}):
            proc = subprocess.run([sys.executable, '-m', 'py_compile', path],
                                  capture_output=True, text=True)
            if proc.returncode != 0:
                detail = (proc.stderr or '').strip().split('\n')
                rep.error(name, detail[0] if detail else '语法错误', rel(path))


def check_protocol_sync(rep):
    """2. 协议常量同步：客户端与服务端对不上，会导致消息静默丢失"""
    name = '协议常量'
    rep.checks += 1

    config = read(os.path.join(JS_DIR, 'config.js'))
    proto = read(os.path.join(SERVER_DIR, 'protocol.py'))
    if not config or not proto:
        rep.warn(name, '读不到 config.js 或 protocol.py，跳过')
        return

    block = re.search(r'GM\.MSG\s*=\s*\{(.*?)\n\s*\};', config, re.S)
    if not block:
        rep.error(name, '在 config.js 中找不到 GM.MSG 定义')
        return
    client = set(re.findall(r":\s*'([a-z]+)'", block.group(1)))

    server = set(re.findall(r"^[CS]_[A-Z_]+\s*=\s*'([a-z]+)'", proto, re.M))

    for missing in sorted(server - client):
        rep.error(name, '服务端有但客户端缺失：%s' % missing, 'js/config.js')
    for extra in sorted(client - server):
        rep.error(name, '客户端有但服务端缺失：%s' % extra, 'server/protocol.py')


FORBIDDEN = [
    (re.compile(r'^\s*var\s+[A-Za-z_$]', re.M), 'error',
     '使用了 var，应改用 const / let'),
    (re.compile(r'\bdebugger\b'), 'error',
     '残留 debugger 断点'),
    (re.compile(r'innerHTML\s*\+?=\s*[^;]*[\+`]'), 'error',
     '用 innerHTML 拼接内容，存在 XSS 风险，应改用 textContent'),
    (re.compile(r'\bconsole\.(log|debug|info)\s*\('), 'warn',
     '残留调试输出 console.*'),
    (re.compile(r'\b(TODO|FIXME|XXX)\b'), 'warn',
     '残留 TODO / FIXME'),
]


def check_forbidden(rep):
    """3. 禁用模式"""
    name = '禁用模式'
    rep.checks += 1

    for path in walk(JS_DIR, {'.js'}):
        text = read(path)
        for pattern, level, message in FORBIDDEN:
            for m in pattern.finditer(text):
                where = '%s:%d' % (rel(path), line_of(text, m.start()))
                if level == 'error':
                    rep.error(name, message, where)
                else:
                    rep.warn(name, message, where)


def check_dom_refs(rep):
    """4. DOM 引用完整性：选择器写错是最高频的低级 bug"""
    name = 'DOM 引用'
    rep.checks += 1

    html = read(INDEX)
    if not html:
        rep.warn(name, '读不到 index.html，跳过')
        return

    ids = set(re.findall(r'\bid="([^"]+)"', html))

    for path in walk(JS_DIR, {'.js'}):
        text = read(path)
        for m in re.finditer(r"""\$\(\s*['"]#([A-Za-z0-9_\-]+)['"]""", text):
            if m.group(1) not in ids:
                rep.error(name, '引用了不存在的 id：#%s' % m.group(1),
                          '%s:%d' % (rel(path), line_of(text, m.start())))
        for m in re.finditer(r"""getElementById\(\s*['"]([A-Za-z0-9_\-]+)['"]""", text):
            if m.group(1) not in ids:
                rep.error(name, '引用了不存在的 id：#%s' % m.group(1),
                          '%s:%d' % (rel(path), line_of(text, m.start())))


# 客户端出现这些，说明棋局规则泄漏到了前端 —— 架构红线
#
# 注意：视图模型里出现 `this.winLine = g.winLine` 是**合法**的，
# 那只是把服务端下发的值存起来。真正要拦的是「自己算」：
# 所以只匹配数组字面量赋值与 push，不匹配 null 或来自服务端的赋值。
RULE_LEAK = [
    (re.compile(r'\bcheckWin\b|\bfindLine\b|_findLine\b'), '胜负判定函数'),
    (re.compile(r'\bDIRECTIONS\b'), '四方向遍历表'),
    (re.compile(r'\[\s*\[\s*1\s*,\s*0\s*\]\s*,\s*\[\s*0\s*,\s*1\s*\]'), '四方向坐标表'),
    (re.compile(r'\bwinLine\s*=\s*\[|\bwinLine\.push\s*\('), '本地计算获胜连线'),
    (re.compile(r'\bwinner\s*=\s*(?:color|turn)\b'), '本地判定胜者'),
]


def check_architecture(rep):
    """5. 架构不变量：客户端不得含任何棋局规则"""
    name = '架构不变量'
    rep.checks += 1

    for path in walk(JS_DIR, {'.js'}):
        text = read(path)
        for pattern, label in RULE_LEAK:
            for m in pattern.finditer(text):
                rep.error(name, '客户端出现「%s」，棋局规则必须只存在于服务端'
                          % label, '%s:%d' % (rel(path), line_of(text, m.start())))

    server = read(os.path.join(SERVER_DIR, 'gomoku.py'))
    if server and 'def place' not in server:
        rep.error(name, '服务端 gomoku.py 缺少 place()，权威判定缺失',
                  'server/gomoku.py')


def check_stdlib_only(rep):
    """6. 零依赖：服务端只允许标准库与同目录模块"""
    name = '零依赖'
    rep.checks += 1

    try:
        stdlib = set(sys.stdlib_module_names)
    except AttributeError:
        stdlib = {
            'os', 're', 'sys', 'json', 'time', 'socket', 'threading', 'random',
            'base64', 'hashlib', 'struct', 'socketserver', 'urllib', 'webbrowser',
        }

    # 服务端目录下允许互相导入；tools / tests 允许导入 server 下的模块
    allowed = set(LOCAL_MODULES)

    for path in walk(SERVER_DIR, {'.py'}):
        text = read(path)
        for m in re.finditer(r'^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)', text, re.M):
            mod = m.group(1)
            if mod in stdlib or mod in allowed:
                continue
            rep.error(name, '引入了第三方模块「%s」，服务端必须保持零依赖' % mod,
                      '%s:%d' % (rel(path), line_of(text, m.start())))


def check_file_size(rep):
    """7. 文件规模：过大的文件通常意味着职责没有拆开"""
    name = '文件规模'
    rep.checks += 1

    for folder, exts, kind in ((JS_DIR, {'.js'}, 'logic'),
                               (SERVER_DIR, {'.py'}, 'logic'),
                               (STYLE_DIR, {'.css'}, 'style')):
        limit = MAX_LINES[kind]
        for path in walk(folder, exts):
            with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
                count = sum(1 for _ in fp)
            if count > limit:
                rep.warn(name, '文件 %d 行，超过 %d 行阈值，考虑按职责拆分'
                          % (count, limit), rel(path))


def check_orphan_files(rep):
    """8. 未引用文件：没人加载的代码是负债，不是资产"""
    name = '未引用文件'
    rep.checks += 1

    html = read(INDEX)
    for path in walk(JS_DIR, {'.js'}):
        if os.path.basename(path) not in html:
            rep.warn(name, '未被 index.html 加载', rel(path))

    for path in walk(STYLE_DIR, {'.css'}):
        if os.path.basename(path) not in html:
            rep.warn(name, '未被 index.html 引用', rel(path))

    sources = '\n'.join(read(p) for p in walk(SERVER_DIR, {'.py'}))
    for path in walk(SERVER_DIR, {'.py'}):
        base = os.path.basename(path)
        if base == 'server.py':
            continue
        mod = os.path.splitext(base)[0]
        if not re.search(r'\b(?:import|from)\s+%s\b' % re.escape(mod), sources):
            rep.warn(name, '未被任何服务端模块导入', rel(path))


CHECKS = [
    check_syntax,
    check_protocol_sync,
    check_forbidden,
    check_dom_refs,
    check_architecture,
    check_stdlib_only,
    check_file_size,
    check_orphan_files,
]


# ---------------------------------------------------------------- 输出


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass

    quiet = '--quiet' in sys.argv or '-q' in sys.argv
    rep = Report()

    for check in CHECKS:
        try:
            check(rep)
        except Exception as exc:                            # noqa: BLE001
            rep.error('门禁自身', '检查项 %s 异常：%s' % (check.__name__, exc))

    line = '=' * 62
    if not quiet:
        print()
        print(line)
        print('  提交前自动化门禁')
        print(line)

    if rep.errors:
        print('\n  ✗ ERROR（必须修复后才能提交）\n')
        for check, message, where in rep.errors:
            print('    [%s] %s%s' % (check, message,
                                     ('  ← ' + where) if where else ''))

    if rep.warns:
        print('\n  ! WARN（建议修复）\n')
        for check, message, where in rep.warns:
            print('    [%s] %s%s' % (check, message,
                                     ('  ← ' + where) if where else ''))

    if not rep.errors and not rep.warns and not quiet:
        print('\n  全部检查通过，没有发现问题。')

    print()
    print(line)
    print('  检查 %d 项  |  ERROR %d  |  WARN %d  |  %s'
          % (rep.checks, len(rep.errors), len(rep.warns),
             '通过' if rep.ok else '未通过'))
    print(line)
    print()

    return 0 if rep.ok else 1


if __name__ == '__main__':
    sys.exit(main())
