<!--
  提交 PR 前请确认已跑完三项检查：
      python tools/preflight.py     （ERROR 必须为 0）
      python tests/test_gomoku.py
      node tests/e2e.mjs
-->

## 改了什么

<!-- 一句话说清。如果一句话说不清，说明这个 PR 太大了，考虑拆分 -->

## 为什么改

<!-- 关联的 Issue / 需求 / 技术债。有关联 Issue 就写 Closes #123 -->

## 怎么验证的

<!-- 必填。不能只写「本地测过了」——那等于没说 -->

- [ ] `python tools/preflight.py` 通过（ERROR = 0）
- [ ] `python tests/test_gomoku.py` 通过
- [ ] `node tests/e2e.mjs` 通过
- [ ] 手工验证：<!-- 具体步骤，例如「开两个窗口建房加入，落子后双方棋盘一致」 -->

## 影响范围

<!-- 影响哪些模块 / 功能？有没有破坏性变更？是否需要同步改协议常量？ -->

## 已知取舍

<!-- 有意没做的事，以及为什么。例如「这次没处理断线场景，留到后续 PR」 -->

---

## 自检

- [ ] 改动在 **400 行以内**（超出请说明为何需要这么大，或拆成多个 PR）
- [ ] 涉及消息协议时，`js/config.js` 与 `server/protocol.py` 已同步修改
- [ ] **没有在客户端 `js/` 下引入任何棋局规则**（胜负判定、四方向遍历等）
- [ ] 已过一遍 [`docs/REVIEW_CHECKLIST.md`](docs/REVIEW_CHECKLIST.md) 的 🔴 项
- [ ] 新增/修改的行为有对应的测试覆盖
