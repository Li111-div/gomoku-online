# -*- coding: utf-8 -*-
"""
gomoku.py — 权威棋局逻辑（服务端唯一真相来源）

这是整个架构的核心：**只有这里会判断落子是否合法、谁赢了**。
客户端不再包含任何棋局规则，只负责把服务端算好的状态画出来。

坐标约定（前后端一致）：
    x 为列，从左到右，0 .. size-1
    y 为行，从上到下，0 .. size-1
    board[y][x] 存放棋子颜色

颜色编码：
    0 = 空   1 = 黑（先手）   2 = 白（后手）   3 = 和棋（仅出现在 winner 里）
"""

EMPTY = 0
BLACK = 1
WHITE = 2
DRAW = 3

# 四个方向：横、竖、撇（主对角线）、捺（副对角线）
DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))

DEFAULT_SIZE = 15
DEFAULT_WIN = 5


def is_coord(value):
    """坐标必须是真正的整数。

    注意：Python 里 bool 是 int 的子类，True/False 会悄悄变成 1/0，
    所以必须单独排除，否则 {'x': True, 'y': False} 会被当成合法落子。
    """
    return isinstance(value, int) and not isinstance(value, bool)


class GomokuGame(object):
    """一局五子棋。每个房间持有独立实例，互不共享任何可变状态。"""

    def __init__(self, size=DEFAULT_SIZE, win_count=DEFAULT_WIN):
        self.size = int(size)
        self.win_count = int(win_count)
        self.reset()

    # ---------------------------------------------------------- 状态

    def reset(self):
        n = self.size
        self.board = [[EMPTY] * n for _ in range(n)]
        self.turn = BLACK
        self.moves = []          # [(x, y, color), ...] 按落子顺序
        self.winner = 0          # 0=未结束 1=黑胜 2=白胜 3=和棋
        self.win_line = None     # [(x, y), ...] 用于高亮
        self.ended = False
        return self

    @property
    def move_count(self):
        return len(self.moves)

    def inside(self, x, y):
        return is_coord(x) and is_coord(y) \
            and 0 <= x < self.size and 0 <= y < self.size

    def at(self, x, y):
        return self.board[y][x] if self.inside(x, y) else -1

    # ---------------------------------------------------------- 落子

    def place(self, x, y, color):
        """尝试落子。返回 {ok, reason?} 或 {ok, win_line, winner, ended}。

        服务端是唯一裁判：越界、已占、非本方回合一律拒绝。
        """
        if self.ended:
            return {'ok': False, 'reason': 'ended'}
        if not self.inside(x, y):
            return {'ok': False, 'reason': 'outside'}
        if self.board[y][x] != EMPTY:
            return {'ok': False, 'reason': 'occupied'}
        if color != self.turn:
            return {'ok': False, 'reason': 'not-turn'}

        self.board[y][x] = color
        self.moves.append((x, y, color))

        line = self._find_line(x, y, color)

        if line:
            self.winner = color
            self.win_line = line
            self.ended = True
        elif len(self.moves) >= self.size * self.size:
            self.winner = DRAW
            self.ended = True
        else:
            self.turn = WHITE if color == BLACK else BLACK

        return {
            'ok': True,
            'win_line': self.win_line,
            'winner': self.winner,
            'ended': self.ended,
        }

    def _find_line(self, x, y, color):
        """从刚落下的这一子出发，向四个方向延伸，看是否连成 win_count 子。"""
        for dx, dy in DIRECTIONS:
            pts = [(x, y)]
            for sign in (1, -1):
                nx = x + dx * sign
                ny = y + dy * sign
                while self.inside(nx, ny) and self.board[ny][nx] == color:
                    pts.append((nx, ny))
                    nx += dx * sign
                    ny += dy * sign
            if len(pts) >= self.win_count:
                return self._trim_line(pts, x, y, dx)
        return None

    def _trim_line(self, pts, x, y, dx):
        """长连（超过 win_count 子）时，截取包含落子点的一段用于高亮。"""
        if len(pts) <= self.win_count:
            return pts

        axis = 0 if dx != 0 else 1
        ordered = sorted(pts, key=lambda p: p[axis])
        anchor = 0
        for i, p in enumerate(ordered):
            if p[0] == x and p[1] == y:
                anchor = i
                break

        start = anchor - self.win_count // 2
        start = max(0, min(start, len(ordered) - self.win_count))
        return ordered[start:start + self.win_count]

    # ---------------------------------------------------------- 悔棋

    def undo(self, steps=1):
        """撤回若干步。返回实际撤回的手数。"""
        removed = 0
        while removed < steps and self.moves:
            x, y, color = self.moves.pop()
            self.board[y][x] = EMPTY
            self.turn = color          # 轮到刚被撤回的一方重下
            removed += 1

        if removed:
            self.winner = 0
            self.win_line = None
            self.ended = False
        return removed

    # ---------------------------------------------------------- 序列化

    def snapshot(self):
        """生成下发给客户端的完整状态。

        棋盘用扁平数组（225 个整数）而不是二维数组，省掉一层嵌套开销。
        客户端按 board[y * size + x] 取值。
        """
        return {
            'size': self.size,
            'winCount': self.win_count,
            'board': [c for row in self.board for c in row],
            'turn': self.turn,
            'winner': self.winner,
            'ended': self.ended,
            'winLine': [[x, y] for (x, y) in self.win_line] if self.win_line else None,
            'moves': [[x, y, c] for (x, y, c) in self.moves],
            'moveCount': len(self.moves),
        }
