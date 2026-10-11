# -*- coding: utf-8 -*-
"""
ws.py — 极简 WebSocket 服务端实现（RFC 6455）

只实现这个项目需要的部分，不引入任何第三方库：
  · 握手（Sec-WebSocket-Accept 计算）
  · 帧解析：文本帧、分片续帧、ping / pong / close
  · 帧写出：服务端发出的帧不加掩码

读走 makefile 返回的缓冲流，写走原始 socket —— 这样从 HTTP 请求头
切到 WebSocket 帧时，不会丢掉已经缓冲的字节。
"""

import base64
import hashlib
import struct
import threading

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

OP_CONT = 0x0
OP_TEXT = 0x1
OP_BIN = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

MAX_PAYLOAD = 1 << 20      # 单帧上限 1MB，防止异常客户端撑爆内存


def accept_key(client_key):
    """按 RFC 6455 计算 Sec-WebSocket-Accept"""
    digest = hashlib.sha1((client_key + GUID).encode('ascii')).digest()
    return base64.b64encode(digest).decode('ascii')


class WebSocketError(Exception):
    pass


class WebSocket(object):
    """把一个已完成握手的 TCP 连接包装成消息通道。

    reader : 由 socket.makefile('rb') 得到的缓冲流
    sock   : 原始 socket，用于写出
    """

    def __init__(self, reader, sock):
        self._r = reader
        self._sock = sock
        self._send_lock = threading.Lock()
        self.closed = False

    # ---------------------------------------------------------- 读取

    def _read_exact(self, n):
        buf = self._r.read(n)
        if buf is None or len(buf) < n:
            raise WebSocketError('连接已断开')
        return buf

    def recv(self):
        """读一条文本消息。连接关闭时返回 None。

        ping 自动回 pong；分片帧自动拼接；二进制帧丢弃。
        """
        chunks = []
        message_op = None

        while True:
            try:
                b1, b2 = struct.unpack('!BB', self._read_exact(2))
            except WebSocketError:
                return None

            fin = b1 & 0x80
            op = b1 & 0x0F
            masked = b2 & 0x80
            length = b2 & 0x7F

            if length == 126:
                length = struct.unpack('!H', self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', self._read_exact(8))[0]

            if length > MAX_PAYLOAD:
                raise WebSocketError('帧过大')

            mask = self._read_exact(4) if masked else None
            payload = self._read_exact(length) if length else b''

            if mask:
                payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))

            # ---- 控制帧：可插在分片中间，不影响消息组装
            if op == OP_CLOSE:
                self.close()
                return None
            if op == OP_PING:
                self._send_frame(OP_PONG, payload)
                continue
            if op == OP_PONG:
                continue

            # ---- 数据帧
            if op in (OP_TEXT, OP_BIN):
                message_op = op
                chunks = [payload]
            elif op == OP_CONT:
                if message_op is None:
                    continue          # 没有起始帧的续帧，丢弃
                chunks.append(payload)
            else:
                continue

            if not fin:
                continue              # 还有后续分片

            data = b''.join(chunks)
            chunks = []
            current_op = message_op
            message_op = None

            if current_op != OP_TEXT:
                continue              # 二进制消息直接忽略

            try:
                return data.decode('utf-8')
            except UnicodeDecodeError:
                raise WebSocketError('非 UTF-8 文本帧')

    # ---------------------------------------------------------- 写出

    def _send_frame(self, opcode, payload):
        header = bytearray()
        header.append(0x80 | opcode)          # FIN + opcode

        n = len(payload)
        if n < 126:
            header.append(n)
        elif n < (1 << 16):
            header.append(126)
            header += struct.pack('!H', n)
        else:
            header.append(127)
            header += struct.pack('!Q', n)

        # 加锁：多个房间线程可能同时往同一个连接推状态
        with self._send_lock:
            self._sock.sendall(bytes(header) + payload)

    def send(self, text):
        """发送一条文本消息。失败返回 False（连接已断）。"""
        if self.closed:
            return False
        try:
            self._send_frame(OP_TEXT, text.encode('utf-8'))
            return True
        except OSError:
            self.closed = True
            return False

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            with self._send_lock:
                self._sock.sendall(b'\x88\x00')     # close 帧，无载荷
        except OSError:
            pass
        try:
            self._sock.shutdown(1)
        except OSError:
            pass
