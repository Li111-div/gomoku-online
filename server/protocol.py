# -*- coding: utf-8 -*-
"""
protocol.py — 前后端消息协议约定

统一格式：{"t": "<类型>", ...其余字段}
方向由上下文决定，同一个名字在两个方向上含义不同（例如 chat）。

设计原则：
  · 客户端只发「意图」，服务端只回「事实」
  · 状态变化一律由服务端广播**完整快照**，客户端不做任何增量推断
"""

# ---------------------------------------------------------------- 客户端 → 服务端

C_HELLO = 'hello'          # {name}                      自我介绍
C_LIST = 'list'            # {}                          拉取房间列表
C_CREATE = 'create'        # {size?, win?}               创建房间并占黑位
C_JOIN = 'join'            # {room}                      加入房间占白位
C_SPECTATE = 'spectate'    # {room}                      观战
C_PRACTICE = 'practice'    # {size?, win?}               练习模式（自己控制双方）
C_MOVE = 'move'            # {x, y}                      落子
C_RESTART = 'restart'      # {}                          请求重新开始
C_UNDO = 'undo'            # {}                          请求悔棋
C_RESPOND = 'respond'      # {kind, accept}              回应对方的请求
C_SURRENDER = 'surrender'  # {}                          认输
C_CHAT = 'chat'            # {text}                      发消息
C_LEAVE = 'leave'          # {}                          离开房间

# ---------------------------------------------------------------- 服务端 → 客户端

S_WELCOME = 'welcome'      # {you:{id,name}, rooms:[...]} 连接就绪
S_ROOMS = 'rooms'          # {list:[...]}                 房间列表更新
S_ROOM = 'room'            # {room:{...}, you:{seat}}     进入房间（含角色）
S_STATE = 'state'          # {state:{...}}                权威状态快照
S_REQUEST = 'request'      # {kind, fromColor, fromName}  对方发来请求
S_CHAT = 'chat'            # {fromColor, name, text}      收到消息
S_ERROR = 'error'          # {message}                    操作被拒绝
S_PEER = 'peer'            # {color, name, event}         对手加入/离开
S_INFO = 'info'            # {message}                    提示信息

# ---------------------------------------------------------------- 房间状态

ROOM_WAITING = 'waiting'   # 等待对手
ROOM_PLAYING = 'playing'   # 对局中
ROOM_ENDED = 'ended'       # 本局已结束（可重新开始）

# ---------------------------------------------------------------- 席位

SEAT_BLACK = 1
SEAT_WHITE = 2
SEAT_NONE = 0              # 观战者
