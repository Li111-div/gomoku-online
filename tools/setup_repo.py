#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
setup_repo.py — 开源前的一次性配置

把仓库里的占位符替换成你自己的信息：
  · README 的 CI 徽章链接与 clone 地址
  · Issue 模板里的 Discussions / 安全报告链接
  · LICENSE 的版权署名

两种用法：

  1) 直接传参（推荐，适合命令行）
       python tools/setup_repo.py zhangsan
       python tools/setup_repo.py zhangsan --name "张三"

  2) 交互模式（双击 setup-repo.bat 走的就是这条）
       python tools/setup_repo.py

交互提示放在 Python 里而不是批处理里，是为了避开 Windows 批处理
set /p 的引号与空格转义问题 —— 用户粘贴带引号的用户名也不会出错。

改完可以直接删掉本脚本，它只用于初始化。
"""

import io
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACEHOLDER = 'YOUR_GITHUB_USERNAME'

TARGETS = [
    'README.md',
    '.github/ISSUE_TEMPLATE/config.yml',
]

DEFAULT_COPYRIGHT = 'gomoku-online contributors'
USERNAME_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}')


def read(path):
    with io.open(path, 'r', encoding='utf-8') as fp:
        return fp.read()


def write(path, text):
    with io.open(path, 'w', encoding='utf-8') as fp:
        fp.write(text)


def ask_username():
    """交互式询问 GitHub 用户名，直到输入合法或用户主动放弃"""
    while True:
        try:
            raw = input('  请输入你的 GitHub 用户名（例如 zhangsan，直接回车取消）: ')
        except (EOFError, KeyboardInterrupt):
            print()
            return None

        value = raw.strip().strip('"').strip("'").lstrip('@')
        if not value:
            return None

        if USERNAME_RE.fullmatch(value):
            return value

        print('  ⚠ 「%s」看起来不是有效的 GitHub 用户名。' % value)
        print('    只能包含字母、数字和连字符，且以字母或数字开头。')
        print()


def ask_author():
    """交互式询问版权署名，允许留空"""
    try:
        raw = input('  请输入版权署名（直接回车用默认值）: ')
    except (EOFError, KeyboardInterrupt):
        print()
        return DEFAULT_COPYRIGHT
    return raw.strip().strip('"').strip("'") or DEFAULT_COPYRIGHT


def apply(username, author):
    """执行替换，返回替换的总处数"""
    changed = 0

    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            print('  [跳过] 找不到 %s' % rel)
            continue
        text = read(path)
        if PLACEHOLDER not in text:
            print('  [跳过] %s 里没有占位符' % rel)
            continue
        count = text.count(PLACEHOLDER)
        write(path, text.replace(PLACEHOLDER, username))
        print('  [完成] %-38s 替换 %d 处' % (rel, count))
        changed += count

    lic = os.path.join(ROOT, 'LICENSE')
    if os.path.isfile(lic):
        text = read(lic)
        new = re.sub(r'Copyright \(c\) \d{4} .+',
                     'Copyright (c) %d %s' % (time.gmtime().tm_year, author),
                     text, count=1)
        if new != text:
            write(lic, new)
            print('  [完成] %-38s 版权行已更新' % 'LICENSE')

    return changed


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass

    positional = [a for a in sys.argv[1:] if not a.startswith('--')]

    # 署名：命令行优先，其次交互询问
    author = None
    if '--name' in sys.argv:
        idx = sys.argv.index('--name')
        if idx + 1 < len(sys.argv):
            author = sys.argv[idx + 1].strip()

    print()
    print('  ' + '=' * 56)
    print('    开源前配置 —— 填写你的 GitHub 用户名')
    print('  ' + '=' * 56)
    print()

    # 用户名：命令行参数优先，否则交互询问
    if positional:
        username = positional[0].strip().lstrip('@')
        if not USERNAME_RE.fullmatch(username):
            print('  ✗ 用户名看起来不太对：%s' % username)
            print('    GitHub 用户名只能包含字母、数字和连字符。\n')
            return 1
    else:
        print('  这一步会把仓库里 5 处占位符替换成你的信息：')
        print('    · README 顶部的 CI 徽章链接')
        print('    · README 里的 git clone 地址')
        print('    · Issue 模板里的 Discussions 与安全报告链接')
        print('    · LICENSE 的版权署名')
        print()
        username = ask_username()
        if username is None:
            print('\n  已取消，没有做任何修改。\n')
            return 1

    if author is None:
        if positional:
            author = DEFAULT_COPYRIGHT
        else:
            author = ask_author()

    print()
    print('  用户名： %s' % username)
    print('  署名：   %s' % author)
    print()

    changed = apply(username, author)

    print()
    if changed:
        print('  ✓ 配置完成，共替换 %d 处占位符。' % changed)
    else:
        print('  · 没有需要替换的内容，可能已经配置过了。')

    print()
    print('  ' + '-' * 56)
    print('  接下来，在本文件夹里打开命令行，执行：')
    print()
    print('      git init')
    print('      git add -A')
    print('      git commit -m "初始提交：服务端权威的五子棋在线对战"')
    print()
    print('  然后在 GitHub 上建好仓库（名字用 gomoku-online），再执行：')
    print()
    print('      git branch -M main')
    print('      git remote add origin https://github.com/%s/gomoku-online.git' % username)
    print('      git push -u origin main')
    print('  ' + '-' * 56)
    print()
    print('  确认无误后可以删掉本脚本： del tools\\setup_repo.py')
    print()

    return 0


if __name__ == '__main__':
    sys.exit(main())
