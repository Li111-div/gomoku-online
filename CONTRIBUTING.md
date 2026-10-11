# 贡献指南

感谢你有兴趣参与这个项目。本文说明如何搭环境、改代码、跑检查、提 PR。

---

## 环境准备

| 需要 | 版本 | 用途 |
|---|---|---|
| **Python** | 3.7+ | 运行服务端、跑检查与单测。**运行时零依赖** |
| **Node.js** | 18+ | 仅用于跑浏览器端到端测试（可选） |

服务端只用 Python 标准库，不需要 `pip install` 任何东西。

---

## 本地运行

```bash
git clone https://github.com/<your-name>/gomoku-online.git
cd gomoku-online

python server/server.py            # 默认 8080 端口
python server/server.py --open     # 启动后自动打开浏览器
```

Windows 用户可以直接双击 `start-server.bat`。

打开页面后点「对战大厅」→「创建房间」，再开一个浏览器窗口用房间号加入，就能自己和自己下。

---

## 提交前必须做的事

**这三步缺一不可**，CI 也会跑同样的检查：

```bash
# 1. 自动化门禁（语法、协议同步、DOM 引用、架构不变量……）
python tools/preflight.py

# 2. 服务端规则单元测试
python tests/test_gomoku.py

# 3. 浏览器端到端测试（需要先装 Playwright）
npm install
npx playwright install chromium
node tests/e2e.mjs
```

Windows 上第 1 步可以双击 `preflight.bat`。

**门禁必须 ERROR = 0**，否则 PR 不会被合并。

---

## 写代码前请先读

| 文档 | 内容 |
|---|---|
| [`docs/CODE_STYLE.md`](docs/CODE_STYLE.md) | 命名、分层、注释、JS / CSS / Python 规范 |
| [`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md) | 审查标准与流程、问题分级、PR 规范 |
| [`docs/REVIEW_CHECKLIST.md`](docs/REVIEW_CHECKLIST.md) | 59 项自查清单，提交前过一遍 |

### 最重要的一条：服务端权威

**所有棋局规则只能写在 `server/gomoku.py` 里。**

客户端 `js/` 目录下**不允许出现任何胜负判定或落子校验**。客户端只做两件事：

1. 把玩家的操作打包成消息发给服务端
2. 把服务端下发的权威状态画出来

门禁里有专门的「架构不变量」检查来守住这条线 —— 如果你不小心在客户端写了 `checkWin` 或四方向遍历，提交时会直接报错。

---

## 项目结构速览

```
server/     服务端（Python，零依赖）—— 唯一权威状态源
  gomoku.py   棋局规则（纯数据层，改规则只改这里）
  rooms.py    房间管理、多对局隔离、并发控制
  ws.py       WebSocket 协议（RFC 6455 手写实现）
  server.py   HTTP 托管 + 消息路由
  protocol.py 消息类型常量

js/         客户端（浏览器）
  board.js    棋盘视图模型（不含规则）
  renderer.js Canvas 渲染
  net.js      WebSocket 客户端
  app.js      主控制器
  chat.js / lobby.js / gameview.js   混入 App 的模块

tools/      提交前自动化门禁
tests/      单元测试 + 端到端测试
docs/       规范与流程文档
```

> **改动消息协议时注意**：`js/config.js` 的 `GM.MSG` 与 `server/protocol.py` 必须同步修改，
> 门禁会检查两边是否一致。

---

## 提交信息规范

用「动词 + 范围 + 目的」的格式：

```
新增 大厅 房间列表实时刷新
修复 聊天 发送方消息被重复渲染
重构 服务端 把棋局操作收敛到 Room 方法
文档 README 补充局域网联机步骤
```

---

## Pull Request 流程

1. **Fork** 仓库并新建分支，分支名用 `fix/xxx`、`feat/xxx`、`docs/xxx`
2. **改动控制在 400 行以内**。超过请拆成多个 PR（纯移动/重命名除外）
3. **跑完上面三步检查**
4. **提 PR**，按模板写清「改了什么 / 为什么改 / 怎么验证的」
5. **回应审查意见**，逐条说明同意或不同意的理由

### 合入条件

- [ ] 门禁 ERROR = 0
- [ ] 单元测试 + 端到端测试全绿
- [ ] 审查意见中 **P0 问题 = 0**
- [ ] P1 问题已修复，或已说明不修复的理由

问题分级标准见 [`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md#4-问题分级与合入门禁)。

---

## 可以贡献什么

**欢迎：**

- 缺陷修复（附最小复现步骤）
- 新功能（**先开 Issue 讨论**，避免白做）
- 文档改进、错别字修正
- 测试用例补充
- 性能优化（附前后对比数据）

**建议先讨论：**

- 引入第三方依赖（服务端会失去「零依赖」这个核心优势）
- 改变现有架构（例如把判定逻辑挪回客户端）
- 大规模重构

---

## 一个提醒：测试也要被验证

本项目在开发过程中反复出现过这种情况 —— **代码是对的，是测试写错了**。

所以当你写测试失败时，先问一句：是代码错了，还是我的断言错了？
排查手段：打印中间状态、加诊断输出，确认到底哪一边不符合预期。

同理，门禁规则也可能误报。**如果规则误报，改规则，不要改判定标准去迁就代码。**

---

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

---

## 许可证

贡献的代码将按 [MIT 许可证](LICENSE) 发布。
