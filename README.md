# DSH 主动提问（私有）

这是独立的 DSH 插件，不依赖 Rabi、RabiRoute、情感交流资料库、角色人格或任何真人聊天记录。

它向所有 DSH 对话全局提供 `queue_user_question`：Agent 可以在推理时把一个可选问题放进当前对话，而工具立即成功返回，Agent 继续工作。问题不设超时；不回答不是同意，也不会使 Agent 卡住。

界面是每个会话独立的。问题在 Agent 提问的那一刻就出现在输入框上方——不等工具返回，所以不会被后续输出挤到看不见的地方。面板里最新的问题展开成卡片，更早的未答问题折叠成单行（可单独“回答”或“跳过”）。提交回答会作为一条新的用户消息发送到该对话；跳过不发送消息，也不会篡改旧工具调用。浏览器仅保存关闭状态和首次显示时间，不另存问题正文或回答。

卡片外观与官方阻塞式 `ask_user_question` 卡片同族：20px 圆角、`--dsw-specific-input-major` 底、`1 / 2` 页码位、单选编号指示器 / 多选复选框、`推荐` 徽标、描边的 `跳过本题` 与主色 `提交`。右上角多一个**倒计时**。

卡片外观**照搬**官方阻塞式 `ask_user_question` 卡片，不是「看起来差不多」：20px 圆角、`--dsw-specific-input-major` 底、`--dsw-elevation-panel` 投影、`20px 16px 0 24px` 的头部内距、`0.5px` 描边、`1 / 2` 页码位、20×20 的单选编号指示器 / 多选复选框、`推荐` 徽标、描边的 `跳过本题` 与主色 `提交`。右上角比原卡片多一个**倒计时**。

这不是官方阻塞式 `ask_user_question` 的替代实现。它把“想听听你的看法”与“必须等待的批准/选择”分开：日常主动询问使用本插件，Agent 不得把沉默当作回答。外观对齐是为了让两种问题读起来像同一族控件，**不是**把语义也对齐——阻塞卡片会等，这张不会。

## 样式是转写，不是重画

`src/client/question-card.module.css` 是 `ui-user-questions/src/client/QuestionComposer.module.css` 的**逐条转写**。那份样式是包内 CSS Module，导不进来，所以属性是抄的、不是重新推的。原文件 132 条声明里 **125 条在这里逐字相同**。

剩下 7 条不在这里，全是两侧「坐的位置不同」的结构性后果，每条都有明确理由（文件头注释里也写了同一份清单）：

| 原声明 | 原选择器 | 为什么这里没有 |
| --- | --- | --- |
| `justify-content: center` | `.frame` | 输入框座位归 dock，没有居中框要复现 |
| `padding: 6px calc(...) 10px` | `.frame` | 同上；侧向留白由 dock 提供 |
| `max-width: var(--dsh-chat-content-width)` | `.card` | dock 已经限了宽，再来一层会重复计算 |
| `max-height: min(60vh, 520px)` | `.card` | 这个座位要和 dock 标题栏分，改成 `min(40vh, 360px)` |
| `max-height: none` | `.cardMinimized` | 这里没有「最小化」，收起是 dock 标题栏的职责 |
| `padding-bottom: 14px` | `.cardMinimized .header` | 属于上面那个不存在的变体 |
| `margin: 0 2px 8px` | `.detail` | 需要 `question.detail` 字段，本插件 store 没有对应物 |

**这些是「不是设计决定」的数字。** 哪个值与原件不同了，那就是这个文件的 bug，不是选择。原卡片改了，两边一起改。

`tests/stylesheet-fidelity.test.mjs` 每次跑 `npm test` 都**重新对原件比对一遍**（不是对一份冻结清单），所以：

- 转写值被改动 → `every shared declaration is transcribed verbatim` 失败；
- 偷偷少抄一条 → 同上失败（负控已验证）；
- 清单里留了条原件已经删掉的「理由」→ `no deviation outlives its justification` 失败；
- 原件自己变了 → 这里立刻看见漂移，而不是慢慢分叉。

原件路径默认指向本机 harness 检出；找不到时这几条测试会带说明跳过，独立 clone 仍然全绿。

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
| 单元测试 | `npm test` | 协议、store、倒计时算术、重绘时钟、**样式转写保真度**。沙箱里渲染不出东西，**只能证明接线**。 |
| 产物测试 | `npm test`（含 `client-bundle.test.mjs`） | 直接对 `lib/client.js` 断言：不出现裸 `React.createElement`、两个槽位都注册。 |
| 渲染冒烟 | `node tests/render-smoke.mjs` | 用真 React + jsdom 渲染**构建产物**，断言用户真正看到的东西，并盯住注入的样式表。 |
| 视觉预览 | `npm run test:visual -- <chromium> <playwright-core> <out-dir> [dark\|light] [newest\|oldest]` | 在真 Chromium 里截图，肉眼看对齐结果。**这是「照搬得像不像」唯一能验的方式**——断言量不出「看起来是不是同一张卡」。 |

`render-smoke.mjs` 补的是前两层都补不上的洞：**槽位边界会吞掉渲染异常**，所以「注册成功但一渲染就抛」在单元测试里是绿的、在用户那里是空的（经典 JSX 那次事故就是这样）。它顺带守住倒计时到点不关闭。它从外围 DSH 工作区借用 `react` / `react-dom` / `jsdom`，不是插件依赖，所以 `npm test` 保持零依赖；换工作区用 `--workspace <path>`。

`visual-preview.mjs` 自己搭了一套 React UMD + `__ModuleLoader__` 桩，主题 token 用本插件用到的那几个（值取自应用自己的明暗两套）。它的原生组件桩只保证**几何**正确（图标占位撑出真实尺寸），不还原官方图标形状——截图用来核对内距、圆角、层次和对齐，不用来核对图标本身。

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
