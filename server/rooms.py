# -*- coding: utf-8 -*-
"""
rooms.py — 房间管理器：多对局隔离与生命周期

隔离原则：
  · 每个 Room 持有独立的 GomokuGame 实例，房间之间不共享任何可变状态
  · RoomManager 用一把全局锁保护「房间字典 + 会话字典」
  · 每个 Room 自己一把锁保护席位与待处理请求
  · 锁顺序永远是 管理器 → 房间，绝不反向，避免死锁
  · 广播时先在锁内取出目标会话列表，出锁后再发 —— 慢客户端不会阻塞整个房间

会话与连接分离：
  Session 代表「一个玩家身份」，连接断了身份还在，因此支持断线重连回原席位。
"""

import random
import threading
import time

import protocol as P
from gomoku import GomokuGame

# 房间码字符集：剔除 I / O 等易混字符
CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
CODE_LEN = 4

# 双方都掉线后，保留房间等待重连的时长（秒）
RECONNECT_GRACE = 180
# 完全没有人的房间，多久后回收（秒）
EMPTY_ROOM_TTL = 300
# 单次落子到下一次落子的最小间隔（秒），防连点刷屏
MOVE_COOLDOWN = 0.05


class Session(object):
    """一个玩家身份。连接可以断，身份保留。"""

    def __init__(self, sid, name='玩家'):
        self.id = sid
        self.name = name
        self.ws = None
        self.room_id = None
        self.color = P.SEAT_NONE       # 0 = 观战
        self.alive = False
        self.offline_at = 0.0
        self._last_move_at = 0.0

    # ---------------------------------------------------------- 发送

    def send(self, obj):
        ws = self.ws
        if not self.alive or ws is None:
            return False
        return ws.send(_dumps(obj))

    def attach(self, ws):
        self.ws = ws
        self.alive = True
        self.offline_at = 0.0

    def detach(self):
        self.alive = False
        self.ws = None
        self.offline_at = time.time()

    # ---------------------------------------------------------- 落子限流

    def allow_move(self):
        now = time.time()
        if now - self._last_move_at < MOVE_COOLDOWN:
            return False
        self._last_move_at = now
        return True


def _dumps(obj):
    import json
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


class Room(object):
    """一个对局房间。持有独立的棋局实例。"""

    def __init__(self, rid, size=15, win_count=5, practice=False):
        self.id = rid
        self.game = GomokuGame(size, win_count)
        self.practice = practice
        self.status = P.ROOM_WAITING
        self.seats = {}            # color -> Session
        self.spectators = []       # [Session]
        self.pending = None        # {'kind': 'restart'|'undo', 'from': color}
        self.created_at = time.time()
        self.last_active = time.time()
        self._lock = threading.RLock()

        if practice:
            # 练习模式：一个连接同时控制黑白双方
            self.status = P.ROOM_PLAYING

    # ---------------------------------------------------------- 席位

    def seat_of(self, session):
        if session.color in (P.SEAT_BLACK, P.SEAT_WHITE):
            if self.seats.get(session.color) is session:
                return session.color
        return P.SEAT_NONE

    def free_color(self):
        for c in (P.SEAT_BLACK, P.SEAT_WHITE):
            if c not in self.seats:
                return c
        return P.SEAT_NONE

    def take_seat(self, session, color):
        """把会话放进指定席位。返回实际拿到的颜色，失败返回 0。"""
        with self._lock:
            if color not in (P.SEAT_BLACK, P.SEAT_WHITE):
                color = self.free_color()
            if color == P.SEAT_NONE:
                return P.SEAT_NONE
            if color in self.seats and self.seats[color] is not session:
                return P.SEAT_NONE

            self.seats[color] = session
            session.room_id = self.id
            session.color = color
            self.last_active = time.time()
            self._refresh_status()
            return color

    def add_spectator(self, session):
        with self._lock:
            if session not in self.spectators:
                self.spectators.append(session)
            session.room_id = self.id
            session.color = P.SEAT_NONE
            self.last_active = time.time()
            return True

    def remove(self, session):
        """把会话移出房间（断开或主动离开）。房间本身不销毁。"""
        with self._lock:
            for color, s in list(self.seats.items()):
                if s is session:
                    del self.seats[color]
            if session in self.spectators:
                self.spectators.remove(session)

            # 请求发起者走了，请求自动作废
            if self.pending and self.pending.get('from') == session.color:
                self.pending = None

            session.room_id = None
            session.color = P.SEAT_NONE
            self._refresh_status()
            self.last_active = time.time()

    def _refresh_status(self):
        if self.practice:
            self.status = P.ROOM_ENDED if self.game.ended else P.ROOM_PLAYING
            return

        has_black = P.SEAT_BLACK in self.seats
        has_white = P.SEAT_WHITE in self.seats

        if has_black and has_white:
            self.status = P.ROOM_ENDED if self.game.ended else P.ROOM_PLAYING
        else:
            self.status = P.ROOM_WAITING

    # ---------------------------------------------------------- 成员

    def members(self):
        """当前应收到广播的会话（在线的玩家 + 观战者）"""
        with self._lock:
            out = [s for s in self.seats.values() if s.alive]
            out += [s for s in self.spectators if s.alive]
        return out

    def player_list(self):
        with self._lock:
            out = []
            for color in (P.SEAT_BLACK, P.SEAT_WHITE):
                s = self.seats.get(color)
                if s:
                    out.append({
                        'color': color,
                        'name': s.name,
                        'connected': s.alive,
                    })
            return out

    def spectator_count(self):
        with self._lock:
            return sum(1 for s in self.spectators if s.alive)

    def is_empty(self):
        """房间是否已经没有任何连接（含观战者）"""
        with self._lock:
            if any(s.alive for s in self.seats.values()):
                return False
            if any(s.alive for s in self.spectators):
                return False
            return True

    # ---------------------------------------------------------- 广播

    def broadcast(self, obj):
        for s in self.members():
            s.send(obj)

    def broadcast_state(self, extra=None):
        state = self.state_snapshot()
        if extra:
            state.update(extra)
        self.broadcast({'t': P.S_STATE, 'state': state})

    # ---------------------------------------------------------- 状态变更
    # 所有会改动棋局的操作都收敛到这里，由房间自己的锁串行化。
    # 外部只调用这些方法，不直接碰 self.game。

    def apply_move(self, x, y, color):
        with self._lock:
            result = self.game.place(x, y, color)
            if result.get('ok'):
                self._refresh_status()
                self.last_active = time.time()
            return result

    def do_undo(self, steps=1):
        with self._lock:
            removed = self.game.undo(steps)
            self.pending = None
            self._refresh_status()
            self.last_active = time.time()
            return removed

    def do_reset(self):
        with self._lock:
            self.game.reset()
            self.pending = None
            self._refresh_status()
            self.last_active = time.time()

    def set_pending(self, kind, color):
        with self._lock:
            self.pending = {'kind': kind, 'from': color}

    def clear_pending(self):
        with self._lock:
            self.pending = None

    def finish_by_surrender(self, loser_color):
        """认输：直接判对方获胜"""
        with self._lock:
            winner = P.SEAT_WHITE if loser_color == P.SEAT_BLACK else P.SEAT_BLACK
            self.game.ended = True
            self.game.winner = winner
            self.game.win_line = None
            self.pending = None
            self._refresh_status()
            self.last_active = time.time()

    # ---------------------------------------------------------- 快照

    def state_snapshot(self):
        return {
            'room': self.id,
            'status': self.status,
            'practice': self.practice,
            'players': self.player_list(),
            'spectators': self.spectator_count(),
            'pending': self.pending,
            'game': self.game.snapshot(),
        }

    def summary(self):
        return {
            'id': self.id,
            'status': self.status,
            'practice': self.practice,
            'size': self.game.size,
            'players': self.player_list(),
            'spectators': self.spectator_count(),
            'moveCount': self.game.move_count,
        }


class RoomManager(object):
    """房间与会话的注册表。全局一把锁保护。"""

    def __init__(self):
        self._lock = threading.RLock()
        self.rooms = {}
        self.sessions = {}

    # ---------------------------------------------------------- 会话

    def get_session(self, sid, name=None):
        with self._lock:
            s = self.sessions.get(sid)
            if s is None:
                s = Session(sid, name or '玩家')
                self.sessions[sid] = s
            elif name:
                s.name = name
            return s

    def drop_session(self, session):
        """连接断开：保留身份与席位，等待重连"""
        session.detach()
        self.broadcast_rooms()

    def reap(self):
        """清理超时的会话与空房间"""
        now = time.time()
        with self._lock:
            # 掉线太久 → 真正离开房间并注销身份
            for sid, s in list(self.sessions.items()):
                if s.alive or now - s.offline_at <= RECONNECT_GRACE:
                    continue
                room = self.rooms.get(s.room_id) if s.room_id else None
                if room:
                    room.remove(s)
                self.sessions.pop(sid, None)

            # 没人的房间回收
            for rid, room in list(self.rooms.items()):
                if room.is_empty() and now - room.last_active > EMPTY_ROOM_TTL:
                    del self.rooms[rid]

    # ---------------------------------------------------------- 房间

    def _new_code(self):
        for _ in range(200):
            code = ''.join(random.choice(CODE_CHARS) for _ in range(CODE_LEN))
            if code not in self.rooms:
                return code
        raise RuntimeError('房间码已用尽')

    def create(self, session, size=15, win_count=5, practice=False):
        with self._lock:
            rid = self._new_code()
            room = Room(rid, size, win_count, practice)
            self.rooms[rid] = room
            # 练习模式同样占黑位，只是落子时忽略颜色、跟着 turn 走
            room.take_seat(session, P.SEAT_BLACK)
            return room

    def get(self, rid):
        with self._lock:
            return self.rooms.get(rid)

    def close(self, rid):
        with self._lock:
            return self.rooms.pop(rid, None)

    def list_public(self):
        with self._lock:
            rooms = [r.summary() for r in self.rooms.values()]
        rooms.sort(key=lambda r: (r['status'] != P.ROOM_WAITING, -r['moveCount']))
        return rooms

    def broadcast_rooms(self):
        payload = {'t': P.S_ROOMS, 'list': self.list_public()}
        for s in self._lobby_sessions():
            s.send(payload)

    def _lobby_sessions(self):
        with self._lock:
            return [s for s in self.sessions.values()
                    if s.alive and not s.room_id]


# 全局唯一的房间管理器：进程内所有对局都由它统一登记
MANAGER = RoomManager()
