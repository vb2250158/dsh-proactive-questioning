# DSH 主动提问（私有）

这是独立的 DSH 插件，不依赖 Rabi、RabiRoute、情感交流资料库、角色人格或任何真人聊天记录。

它向所有 DSH 对话全局提供 `queue_user_question`：Agent 可以在推理时把一个可选问题放进当前对话，而工具立即成功返回，Agent 继续工作。问题不设超时；不回答不是同意，也不会使 Agent 卡住。

界面是每个会话独立的。问题在 Agent 提问的那一刻就出现在输入框上方——不等工具返回，所以不会被后续输出挤到看不见的地方。面板里最新的问题展开成卡片，更早的未答问题折叠成单行（可单独“回答”或“跳过”）。提交回答会作为一条新的用户消息发送到该对话；跳过不发送消息，也不会篡改旧工具调用。浏览器仅保存关闭状态和首次显示时间，不另存问题正文或回答。

卡片外观与官方阻塞式 `ask_user_question` 卡片同族：20px 圆角、`--dsw-specific-input-major` 底、`1 / 2` 页码位、单选编号指示器 / 多选复选框、`推荐` 徽标、描边的 `跳过本题` 与主色 `提交`。右上角多一个**倒计时**。

这不是官方阻塞式 `ask_user_question` 的替代实现。它把“想听听你的看法”与“必须等待的批准/选择”分开：日常主动询问使用本插件，Agent 不得把沉默当作回答。外观对齐是为了让两种问题读起来像同一族控件，**不是**把语义也对齐——阻塞卡片会等，这张不会。

## 倒计时量的是「新鲜期」，不是截止时间

倒计时复用强调窗口 `ACTIVE_WINDOW_MS`（120 秒），数的是「还能算新问题」的剩余时间，**不是**回答期限。

- 归零后问题**仍然留在面板里，仍然可以回答**——只是从强调态退成普通态，读数变成 `已保留`。
- **不存在任何超时自动关闭、自动跳过或丢弃**。把倒计时实现成到点关闭是本插件最不能犯的错，`tests/render-smoke.mjs` 第 5 组断言专门盯着这一条（故意注入 `skipAll` 会让它失败）。
- 数字会逐秒变化，靠 `QuestionStore` 里一个共享的秒级重绘时钟；它只在确实有未答问题时运行，且已 `unref()`，所以无浏览器的主机不会因为一个空转的定时器而拒绝退出。

## 本机开发

```powershell
pnpm install
pnpm check
```

`pnpm build` 生成私有 DSH 插件的 Host 与 Web ModuleLoader bundle。加入 Web Profile、重启 DSH 并刷新网页后，新会话和已有会话的后续工具调用都可使用它。

### 三层验证，各自盯不同的洞

| 手段 | 跑法 | 盯什么 |
| --- | --- | --- |
| 单元测试 | `npm test` | 协议、store、倒计时算术、重绘时钟。沙箱里渲染不出东西，**只能证明接线**。 |
| 产物测试 | `npm test`（含 `client-bundle.test.mjs`） | 直接对 `lib/client.js` 断言：不出现裸 `React.createElement`、两个槽位都注册。 |
| 渲染冒烟 | `node tests/render-smoke.mjs` | 用真 React + jsdom 渲染**构建产物**，断言用户真正看到的东西。 |

`render-smoke.mjs` 补的是前两层都补不上的洞：**槽位边界会吞掉渲染异常**，所以「注册成功但一渲染就抛」在单元测试里是绿的、在用户那里是空的（经典 JSX 那次事故就是这样）。它顺带守住倒计时到点不关闭。它从外围 DSH 工作区借用 `react` / `react-dom` / `jsdom`，不是插件依赖，所以 `npm test` 保持零依赖；换工作区用 `--workspace <path>`。

### 客户端构建必须用自动 JSX 运行时

`scripts/build.mjs` 的 client 构建带 `jsx: 'automatic'`，产物里的 JSX 走 `react/jsx-runtime`。
**不要删掉这一行**：esbuild 默认走经典运行时，会生成裸 `React.createElement`，而本插件的组件只从 `react` 具名导入 hooks、没有默认导入 `React`，
于是每个槽位组件在渲染时抛 `ReferenceError: React is not defined`，槽位边界吞掉异常后用户什么也看不到——工具卡片和面板一起消失。
源码侧看不出来（TS 本来就是 `react-jsx`），所以 `tests/client-bundle.test.mjs` 直接对 `lib/client.js` 断言，并由 `npm test` 兜住；
`tests/render-smoke.mjs` 再在真 React 下复现同一个失败。

## 两条会话身份通道（改动前必读）

- **工具行**：`tool.call.toolview` 的组件从 props 拿 `sessionId`——session 作用域的槽位组件会合并 `SessionStandardProps`。官方 `ask_user_question` 视图也是这么做的。
- **输入框上方面板**：`conversation.input.dock` 是 session 作用域，注册时的 `inject` 工厂收到的是**位置参数** `inject(sessionId)`，不是 props 对象。

写成 `inject: (props) => props.sessionId` 会让每个 occurrence 都解析不到会话，面板永远返回 `null` —— 这正是「问题从来没弹出来」的根因。参照 `ui-goal` 的 `GoalDock`（占同一槽位）：`inject: (sessionId) => …`。详见 `docs/DESIGN.md`。
