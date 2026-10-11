#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
server.py — 五子棋客户端-服务器版服务端

一个进程同时负责三件事：
  1. 托管网页静态文件（别人访问你的 IP:端口 就能打开游戏）
  2. 维护所有房间，每个房间一份独立的权威棋局
  3. 处理所有对局逻辑，把算好的完整状态推给客户端

客户端只做两件事：把点击发上来、把收到的状态画出来。
因此不存在「两边算法不一致」这类同步问题 —— 服务端是唯一真相来源。

只用 Python 标准库，零依赖。需要 Python 3.7+。

用法：
    python server/server.py                  # 默认 8080 端口
    python server/server.py 9000             # 指定端口
    python server/server.py 9000 127.0.0.1   # 只监听本机
    python server/server.py --open           # 启动后自动打开浏览器
"""

import json
import os
import socket
import socketserver
import sys
import threading
import time
from urllib.parse import unquote, urlparse

import protocol as P
import ws as WS
from rooms import MANAGER

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.dirname(SERVER_DIR)      # 网页在 server/ 的上一级
DEFAULT_PORT = 8080

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
}

MAX_BODY = 1 << 20


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def log(*args):
    stamp = time.strftime('%H:%M:%S')
    print('[%s]' % stamp, *args, flush=True)


# ================================================================ 客户端会话


class Client(object):
    """一条 WebSocket 连接对应的客户端句柄。"""

    def __init__(self, channel):
        self.channel = channel
        self.session = None
        self.closed = False

    def send(self, obj):
        if self.closed:
            return False
        ok = self.channel.send(dumps(obj))
        if not ok:
            self.closed = True
        return ok

    def error(self, message):
        self.send({'t': P.S_ERROR, 'message': message})


def you_payload(session):
    return {
        'id': session.id,
        'name': session.name,
        'seat': session.color,
        'room': session.room_id,
    }


def room_of(session):
    if not session or not session.room_id:
        return None
    return MANAGER.get(session.room_id)


def opponent_of(room, color):
    other = P.SEAT_WHITE if color == P.SEAT_BLACK else P.SEAT_BLACK
    return room.seats.get(other)


# ================================================================ 消息处理


def on_hello(client, msg):
    sid = str(msg.get('sessionId') or '')[:40].strip()
    if not sid:
        sid = 's' + os.urandom(6).hex()

    name = str(msg.get('name') or '').strip()[:12] or '玩家'
    session = MANAGER.get_session(sid, name)
    session.attach(client.channel)
    client.session = session

    # 断线重连：席位在断开时是保留的，这里只需要把新连接挂上去
    room = room_of(session)
    if room:
        client.send({'t': P.S_ROOM, 'room': room.state_snapshot(),
                     'you': you_payload(session)})
        room.broadcast_state()
        room.broadcast({'t': P.S_PEER, 'event': 'rejoin',
                        'name': session.name, 'color': session.color})
        log('%s 重连回房间 %s' % (name, room.id))
    else:
        client.send({'t': P.S_WELCOME, 'you': you_payload(session),
                     'rooms': MANAGER.list_public()})
        log('%s 进入大厅' % name)

    MANAGER.broadcast_rooms()
    return session


def on_list(client, msg):
    client.send({'t': P.S_ROOMS, 'list': MANAGER.list_public()})


def board_params(msg):
    try:
        size = int(msg.get('size') or 15)
    except (TypeError, ValueError):
        size = 15
    try:
        win = int(msg.get('win') or 5)
    except (TypeError, ValueError):
        win = 5
    return max(9, min(size, 19)), max(3, min(win, 7))


def leave_current_room(session, notify=True):
    room = room_of(session)
    if room is None:
        session.room_id = None
        session.color = P.SEAT_NONE
        return None

    name, color = session.name, session.color
    room.remove(session)

    if notify and color in (P.SEAT_BLACK, P.SEAT_WHITE):
        room.broadcast_state()
        room.broadcast({'t': P.S_PEER, 'event': 'left', 'name': name, 'color': color})
    elif notify:
        room.broadcast_state()

    if room.is_empty():
        MANAGER.close(room.id)
    MANAGER.broadcast_rooms()
    return room


def enter_room(client, room):
    session = client.session
    client.send({'t': P.S_ROOM, 'room': room.state_snapshot(),
                 'you': you_payload(session)})
    room.broadcast_state()
    MANAGER.broadcast_rooms()


def on_create(client, msg):
    session = client.session
    leave_current_room(session)
    size, win = board_params(msg)
    room = MANAGER.create(session, size, win, practice=False)
    enter_room(client, room)
    log('%s 创建房间 %s（%d×%d）' % (session.name, room.id, size, size))


def on_practice(client, msg):
    session = client.session
    leave_current_room(session)
    size, win = board_params(msg)
    room = MANAGER.create(session, size, win, practice=True)
    enter_room(client, room)
    log('%s 开始练习（%d×%d）' % (session.name, size, size))


def on_join(client, msg):
    session = client.session
    rid = str(msg.get('room') or '').strip().upper()
    room = MANAGER.get(rid)

    if room is None:
        return client.error('房间不存在或已关闭')
    if room.practice:
        return client.error('这是练习房间，其他人无法加入')

    leave_current_room(session)

    color = room.free_color()
    if color == P.SEAT_NONE:
        room.add_spectator(session)
        enter_room(client, room)
        room.broadcast({'t': P.S_PEER, 'event': 'spectate',
                        'name': session.name, 'color': P.SEAT_NONE})
        log('%s 观战房间 %s' % (session.name, rid))
        return

    room.take_seat(session, color)
    enter_room(client, room)
    room.broadcast({'t': P.S_PEER, 'event': 'joined',
                    'name': session.name, 'color': color})
    log('%s 加入房间 %s，执%s' % (session.name, rid, '黑' if color == 1 else '白'))


def on_spectate(client, msg):
    session = client.session
    rid = str(msg.get('room') or '').strip().upper()
    room = MANAGER.get(rid)
    if room is None:
        return client.error('房间不存在或已关闭')

    leave_current_room(session)
    room.add_spectator(session)
    enter_room(client, room)
    room.broadcast({'t': P.S_PEER, 'event': 'spectate',
                    'name': session.name, 'color': P.SEAT_NONE})


def on_move(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return client.error('你还没有进入房间')

    x, y = msg.get('x'), msg.get('y')
    # 严格校验：bool 是 int 的子类，要单独挡掉
    if not isinstance(x, int) or not isinstance(y, int) \
            or isinstance(x, bool) or isinstance(y, bool):
        return client.error('坐标不合法')

    if not session.allow_move():
        return          # 连点：静默丢弃，不报错

    color = room.game.turn if room.practice else session.color
    if color not in (P.SEAT_BLACK, P.SEAT_WHITE):
        return client.error('观战者不能落子')

    result = room.apply_move(x, y, color)
    if not result.get('ok'):
        return client.error(reason_text(result.get('reason')))

    room.broadcast_state()
    if room.game.ended:
        room.broadcast({'t': P.S_INFO, 'message': result_text(room)})
        MANAGER.broadcast_rooms()


def reason_text(reason):
    return {
        'ended': '本局已经结束了',
        'outside': '这个位置在棋盘外',
        'occupied': '这个位置已经有棋子了',
        'not-turn': '还没轮到你落子',
    }.get(reason, '这一步不能这么下')


def result_text(room):
    g = room.game
    if g.winner == P.DRAW:
        return '棋盘已满，本局和棋'
    who = '黑方' if g.winner == P.SEAT_BLACK else '白方'
    return '%s连成五子，获胜！' % who


def on_restart(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return client.error('你还没有进入房间')

    if room.practice:
        room.do_reset()
        room.broadcast_state()
        return

    color = session.color
    if color not in (P.SEAT_BLACK, P.SEAT_WHITE):
        return client.error('观战者不能操作')

    opponent = opponent_of(room, color)
    if opponent is None or not opponent.alive:
        room.do_reset()
        room.broadcast_state()
        return

    room.set_pending('restart', color)
    room.broadcast_state()
    opponent.send({'t': P.S_REQUEST, 'kind': 'restart',
                   'fromColor': color, 'fromName': session.name})


def on_undo(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return client.error('你还没有进入房间')

    if room.game.move_count == 0:
        return client.error('还没有落子，无法悔棋')

    if room.practice:
        room.do_undo(1)
        room.broadcast_state()
        return

    color = session.color
    if color not in (P.SEAT_BLACK, P.SEAT_WHITE):
        return client.error('观战者不能操作')
    if room.game.move_count < 2:
        return client.error('至少需要双方各走一步才能悔棋')

    opponent = opponent_of(room, color)
    if opponent is None or not opponent.alive:
        room.do_undo(2)
        room.broadcast_state()
        return

    room.set_pending('undo', color)
    room.broadcast_state()
    opponent.send({'t': P.S_REQUEST, 'kind': 'undo',
                   'fromColor': color, 'fromName': session.name})


def on_respond(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return client.error('你还没有进入房间')

    kind = str(msg.get('kind') or '')
    accept = bool(msg.get('accept'))
    pending = room.pending

    if not pending or pending.get('kind') != kind:
        return client.error('没有待处理的请求')
    if pending.get('from') == session.color:
        return client.error('不能回应自己发出的请求')

    if not accept:
        room.clear_pending()
        other = opponent_of(room, session.color)
        if other:
            other.send({'t': P.S_INFO, 'message': '%s 拒绝了你的请求' % session.name})
        room.broadcast_state()
        return

    if kind == 'restart':
        room.do_reset()
        room.broadcast_state()
        room.broadcast({'t': P.S_INFO, 'message': '双方同意，重新开始'})
    elif kind == 'undo':
        room.do_undo(2)
        room.broadcast_state()
        room.broadcast({'t': P.S_INFO, 'message': '双方同意，撤回两步'})
    else:
        room.clear_pending()
        client.error('未知的请求类型')


def on_surrender(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return client.error('你还没有进入房间')

    if room.practice:
        room.do_reset()
        room.broadcast_state()
        return

    color = session.color
    if color not in (P.SEAT_BLACK, P.SEAT_WHITE):
        return client.error('观战者不能操作')

    room.finish_by_surrender(color)
    room.broadcast_state()
    room.broadcast({'t': P.S_INFO, 'message': '%s 认输了' % session.name})
    MANAGER.broadcast_rooms()


def on_chat(client, msg):
    session = client.session
    room = room_of(session)
    if room is None:
        return

    text = str(msg.get('text') or '').strip()[:60]
    if not text:
        return

    room.broadcast({'t': P.S_CHAT, 'fromColor': session.color,
                    'name': session.name, 'text': text})


def on_leave(client, msg):
    session = client.session
    leave_current_room(session)
    client.send({'t': P.S_ROOM, 'room': None, 'you': you_payload(session)})


ROUTES = {
    P.C_LIST: on_list,
    P.C_CREATE: on_create,
    P.C_PRACTICE: on_practice,
    P.C_JOIN: on_join,
    P.C_SPECTATE: on_spectate,
    P.C_MOVE: on_move,
    P.C_RESTART: on_restart,
    P.C_UNDO: on_undo,
    P.C_RESPOND: on_respond,
    P.C_SURRENDER: on_surrender,
    P.C_CHAT: on_chat,
    P.C_LEAVE: on_leave,
}


def handle_message(client, msg):
    if not isinstance(msg, dict):
        return
    kind = msg.get('t')

    if kind == P.C_HELLO:
        on_hello(client, msg)
        return

    if client.session is None:
        client.error('请先发送 hello 完成握手')
        return

    handler = ROUTES.get(kind)
    if handler is None:
        client.error('未知指令：%s' % kind)
        return
    handler(client, msg)


# ================================================================ 连接处理


def serve_client(channel):
    """一条 WebSocket 连接的完整生命周期"""
    client = Client(channel)
    try:
        while True:
            raw = channel.recv()
            if raw is None:
                break
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            handle_message(client, msg)
    except (OSError, WS.WebSocketError):
        pass
    finally:
        client.closed = True
        session = client.session
        if session is not None:
            # 断线：保留席位等待重连，不立刻踢出房间
            room = room_of(session)
            if room:
                room.broadcast_state()
            MANAGER.drop_session(session)
            log('%s 断开连接' % session.name)
        try:
            channel.close()
        except OSError:
            pass


# ================================================================ HTTP


class Handler(socketserver.BaseRequestHandler):

    def handle(self):
        sock = self.request
        try:
            reader = sock.makefile('rb')
        except OSError:
            return

        try:
            self._process(reader, sock)
        except (OSError, WS.WebSocketError):
            pass
        finally:
            try:
                reader.close()
            except OSError:
                pass

    # ---------------------------------------------------------- 解析

    def _process(self, reader, sock):
        line = reader.readline(8192)
        if not line:
            return
        try:
            method, target, _ = line.decode('latin-1').split()
        except ValueError:
            return

        headers = self._read_headers(reader)

        if headers.get('upgrade', '').lower() == 'websocket':
            return self._upgrade(reader, sock, headers)

        if method != 'GET':
            return self._plain(sock, 405, 'Method Not Allowed', b'')
        return self._static(sock, target)

    @staticmethod
    def _read_headers(reader):
        headers = {}
        while True:
            line = reader.readline(8192)
            if not line or line in (b'\r\n', b'\n'):
                break
            try:
                text = line.decode('latin-1')
            except UnicodeDecodeError:
                continue
            key, _, value = text.partition(':')
            if key:
                headers[key.strip().lower()] = value.strip()
        return headers

    # ---------------------------------------------------------- WebSocket

    def _upgrade(self, reader, sock, headers):
        key = headers.get('sec-websocket-key', '')
        if not key:
            return self._plain(sock, 400, 'Bad Request', b'')

        head = (
            'HTTP/1.1 101 Switching Protocols\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            'Sec-WebSocket-Accept: ' + WS.accept_key(key) + '\r\n\r\n'
        )
        sock.sendall(head.encode('ascii'))
        serve_client(WS.WebSocket(reader, sock))

    # ---------------------------------------------------------- 静态文件

    def _plain(self, sock, code, phrase, body, ctype='text/plain; charset=utf-8'):
        head = (
            'HTTP/1.1 %d %s\r\n'
            'Content-Type: %s\r\n'
            'Content-Length: %d\r\n'
            'Connection: close\r\n\r\n'
        ) % (code, phrase, ctype, len(body))
        try:
            sock.sendall(head.encode('ascii') + body)
        except OSError:
            pass

    def _static(self, sock, target):
        path = unquote(urlparse(target).path)
        if path == '/':
            path = '/index.html'

        # 防目录穿越：拼好后必须仍在 WEB_ROOT 之内
        full = os.path.normpath(os.path.join(WEB_ROOT, path.lstrip('/')))
        if not full.startswith(WEB_ROOT + os.sep) and full != WEB_ROOT:
            return self._plain(sock, 403, 'Forbidden', b'')
        if not os.path.isfile(full):
            return self._plain(sock, 404, 'Not Found', b'Not Found')

        try:
            with open(full, 'rb') as fp:
                body = fp.read()
        except OSError:
            return self._plain(sock, 500, 'Internal Server Error', b'')

        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, 'application/octet-stream')
        head = (
            'HTTP/1.1 200 OK\r\n'
            'Content-Type: %s\r\n'
            'Content-Length: %d\r\n'
            'Cache-Control: no-store\r\n'
            'Connection: close\r\n\r\n'
        ) % (ctype, len(body))
        try:
            sock.sendall(head.encode('ascii') + body)
        except OSError:
            pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


# ================================================================ 后台任务


def reaper_loop():
    while True:
        time.sleep(30)
        try:
            MANAGER.reap()
            MANAGER.broadcast_rooms()
        except Exception as exc:                       # noqa: BLE001
            log('清理任务异常：%s' % exc)


# ================================================================ 启动


def get_lan_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(('8.8.8.8', 80))
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return '127.0.0.1'


def parse_args(argv):
    port = DEFAULT_PORT
    host = '0.0.0.0'
    auto_open = False
    for arg in argv:
        if arg in ('--open', '-o'):
            auto_open = True
        elif arg in ('--help', '-h'):
            print(__doc__)
            sys.exit(0)
        elif arg.isdigit():
            port = int(arg)
        else:
            host = arg
    return host, port, auto_open


def banner(ip, port):
    line = '=' * 54
    print()
    print(line)
    print('  五子棋 · 服务端已启动（所有对局逻辑在本机运行）')
    print(line)
    print()
    print('  本机访问：   http://127.0.0.1:%d' % port)
    print('  局域网访问： http://%s:%d' % (ip, port))
    print()
    print('  把这个「局域网访问」地址发给朋友，他们用浏览器打开就能玩。')
    print('  同一时间可以开任意多个房间，互不干扰。')
    print()
    print('  按 Ctrl+C 停止服务。')
    print(line)
    print()


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass

    host, port, auto_open = parse_args(sys.argv[1:])
    ip = get_lan_ip()

    try:
        server = Server((host, port), Handler)
    except OSError as exc:
        print()
        print('  启动失败：%s' % exc)
        print('  端口 %d 可能已被占用，换一个试试：' % port)
        print('      python server/server.py %d' % (port + 1))
        print()
        sys.exit(1)

    banner(ip, port)
    threading.Thread(target=reaper_loop, daemon=True).start()

    if auto_open:
        def _open():
            time.sleep(0.8)
            import webbrowser
            webbrowser.open('http://127.0.0.1:%d' % port)
        threading.Thread(target=_open, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  已停止。\n')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
