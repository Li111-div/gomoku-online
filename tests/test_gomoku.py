#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
服务端棋局规则单元测试

这是整个项目最重要的一组测试 —— 因为「谁赢了」这件事只由服务端说了算，
这里的规则一旦有错，所有客户端都会跟着错。

零依赖，直接运行：
    python tests/test_gomoku.py
"""

import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

from gomoku import GomokuGame, BLACK, WHITE, DRAW, EMPTY   # noqa: E402


class Runner(object):
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def check(self, name, condition, extra=''):
        if condition:
            self.passed += 1
            print('  PASS  %s' % name)
        else:
            self.failed += 1
            print('  FAIL  %s%s' % (name, ('  -> %s' % extra) if extra else ''))

    def section(self, title):
        print('\n=== %s ===' % title)


def play(seq):
    """按 (x, y, color) 序列依次落子，任一步失败即抛错"""
    game = GomokuGame(15, 5)
    for x, y, color in seq:
        result = game.place(x, y, color)
        if not result['ok']:
            raise AssertionError('落子失败 (%d,%d): %s' % (x, y, result.get('reason')))
    return game


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass

    r = Runner()

    # ---------------------------------------------------------- 胜负判定

    r.section('1. 胜负判定')

    g = play([(3, 7, 1), (3, 8, 2), (4, 7, 1), (4, 8, 2), (5, 7, 1),
              (5, 8, 2), (6, 7, 1), (6, 8, 2), (7, 7, 1)])
    r.check('横向五连获胜', g.ended and g.winner == BLACK, g.winner)
    r.check('横向连线长度为 5', g.win_line and len(g.win_line) == 5,
            len(g.win_line) if g.win_line else 0)

    g = play([(7, 3, 1), (8, 3, 2), (7, 4, 1), (8, 4, 2), (7, 5, 1),
              (8, 5, 2), (7, 6, 1), (8, 6, 2), (7, 7, 1)])
    r.check('纵向五连获胜', g.ended and g.winner == BLACK, g.winner)

    g = play([(3, 3, 1), (4, 3, 2), (4, 4, 1), (5, 3, 2), (5, 5, 1),
              (6, 3, 2), (6, 6, 1), (7, 3, 2), (7, 7, 1)])
    r.check('主对角线五连获胜', g.ended and g.winner == BLACK, g.winner)

    g = play([(3, 11, 1), (3, 3, 2), (4, 10, 1), (4, 3, 2), (5, 9, 1),
              (5, 3, 2), (6, 8, 1), (6, 3, 2), (7, 7, 1)])
    r.check('副对角线五连获胜', g.ended and g.winner == BLACK, g.winner)

    g = play([(3, 7, 1), (3, 8, 2), (4, 7, 1), (4, 8, 2), (5, 7, 1),
              (5, 8, 2), (6, 7, 1), (6, 8, 2)])
    r.check('四连不算获胜', not g.ended, g.ended)

    # 长连：先在 2,3,5,6,7 落子（中间空一格），再补 4 形成六连
    g = play([(2, 7, 1), (2, 8, 2), (3, 7, 1), (3, 8, 2), (5, 7, 1),
              (5, 8, 2), (6, 7, 1), (6, 8, 2), (7, 7, 1), (7, 8, 2), (4, 7, 1)])
    r.check('补中间成六连判定获胜', g.ended and g.winner == BLACK, g.winner)
    r.check('六连高亮截取为 5 子', g.win_line and len(g.win_line) == 5,
            len(g.win_line) if g.win_line else 0)
    r.check('高亮连线包含刚落的这一子',
            g.win_line is not None and (4, 7) in [tuple(p) for p in g.win_line],
            g.win_line)

    # ---------------------------------------------------------- 落子规则

    r.section('2. 落子规则')

    g = GomokuGame(15, 5)
    r.check('黑方先手可落子', g.place(7, 7, BLACK)['ok'] is True)
    r.check('同一位置不能重复落子', g.place(7, 7, WHITE)['ok'] is False)
    r.check('不能连下两手', g.place(8, 8, BLACK)['ok'] is False)
    r.check('白方可以落子', g.place(8, 8, WHITE)['ok'] is True)
    r.check('越界（负）被拒绝', g.place(-1, 0, BLACK)['ok'] is False)
    r.check('越界（超出右边界）被拒绝', g.place(15, 0, BLACK)['ok'] is False)
    r.check('越界（超出下边界）被拒绝', g.place(0, 15, BLACK)['ok'] is False)

    # ---------------------------------------------------------- 悔棋

    r.section('3. 悔棋')

    g = GomokuGame(15, 5)
    g.place(7, 7, BLACK)
    g.place(8, 8, WHITE)
    g.place(7, 8, BLACK)
    r.check('悔棋前手数为 3', g.move_count == 3, g.move_count)
    removed = g.undo(2)
    r.check('一次撤回两步', removed == 2, removed)
    r.check('悔棋后手数为 1', g.move_count == 1, g.move_count)
    r.check('悔棋后轮到白方', g.turn == WHITE, g.turn)
    r.check('被撤回的格子已清空', g.at(8, 8) == EMPTY and g.at(7, 8) == EMPTY)

    # ---------------------------------------------------------- 和棋

    r.section('4. 和棋')

    g = GomokuGame(3, 5)          # 3×3 却要求五连，必然和棋
    filled = 0
    for y in range(3):
        for x in range(3):
            if g.place(x, y, g.turn)['ok']:
                filled += 1
    r.check('棋盘填满共 9 手', filled == 9, filled)
    r.check('填满后判和棋', g.ended and g.winner == DRAW, g.winner)

    # ---------------------------------------------------------- 快照结构

    r.section('5. 快照结构')

    g = GomokuGame(15, 5)
    g.place(3, 3, BLACK)
    g.place(3, 4, WHITE)
    snap = g.snapshot()
    r.check('棋盘为扁平数组', isinstance(snap['board'], list) and len(snap['board']) == 225,
            len(snap['board']))
    r.check('手数正确', snap['moveCount'] == 2, snap['moveCount'])
    r.check('落子记录正确', snap['moves'] == [[3, 3, 1], [3, 4, 2]], snap['moves'])
    r.check('轮次正确', snap['turn'] == BLACK, snap['turn'])
    r.check('扁平数组索引为 y*size+x', snap['board'][3 * 15 + 3] == BLACK)

    # ---------------------------------------------------------- 健壮性

    r.section('6. 非法输入健壮性')

    g = GomokuGame(15, 5)
    for bad in [('a', 1), (None, None), (1.5, 2), (True, False), ([], {})]:
        try:
            result = g.place(bad[0], bad[1], BLACK)
            r.check('非法坐标 %r 被安全拒绝' % (bad,), result['ok'] is False, result)
        except Exception as exc:                      # noqa: BLE001
            r.check('非法坐标 %r 被安全拒绝' % (bad,), False, repr(exc))

    # ---------------------------------------------------------- 汇总

    print('\n' + '=' * 48)
    print('  通过 %d 项，失败 %d 项' % (r.passed, r.failed))
    print('=' * 48 + '\n')
    return 1 if r.failed else 0


if __name__ == '__main__':
    sys.exit(main())
