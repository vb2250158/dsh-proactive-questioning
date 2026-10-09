# DSH 主动提问（私有）

## 0.1.12：直接发送与回答卡片

单选点击后直接发送；自由回答按 Enter 或点击“发送回答”，Shift+Enter 换行；多选勾选完成后点击“发送回答”。发送期间锁定本题，成功后关闭，失败保留所选内容与草稿供重试。回答发送到原会话的队列，当前执行完成后处理。

聊天记录将回答显示为卡片，分开呈现问题、选项和补充文字，保留时间与复制。旧版回答也适用；复制仍得到完整原文。普通用户消息与 steering 消息由本插件通过公开 keyed renderer 显示，保留附件、引用、长文本、额外内容和复制；格式不完整时显示原文。卸载插件后宿主恢复原渲染器。[English behavior and compatibility](docs/answers.md).

此版本将单选从“选择后提交”改为“点击即发送”，不再允许单选提交前切换选项。多选与自由文字仍可编辑后发送。

This release requires DSH 0.2.1-alpha.1 or a compatible 0.2 release. See [compatibility details](docs/dsh-0.2-compatibility.md).

## 0.1.6：图文说明与提问面板

新增供对话增强渲染的公开内容插槽，支持问题与选项图文说明；提交仍保留原始选项标签。同步发布紧凑布局、分页草稿保留和会话服务解析修复。

这是独立的 DSH 插件，不依赖 Rabi、RabiRoute、情感交流资料库、角色人格或任何真人聊天记录。

它向所有 DSH 对话全局提供 `queue_user_question`：Agent 可以在推理时把一个可选问题放进当前对话，而工具立即成功返回，Agent 继续工作。问题不设超时；不回答不是同意，也不会使 Agent 卡住。

界面是每个会话独立的。问题在 Agent 提问的那一刻就出现在输入框上方——不等工具返回，所以不会被后续输出挤到看不见的地方。面板里最新的问题展开成卡片，更早的未答问题折叠成单行（可单独“回答”或“跳过”）。提交回答会作为一条新的用户消息发送到该对话；跳过不发送消息，也不会篡改旧工具调用。浏览器仅保存关闭状态和首次显示时间，不另存问题正文或回答。

## 提问面板

问题可带 `detail`，选项可带 `description`，各最多 12000 字符。配合新版 `dsh-chat-enhancement`，这些字段及 `question` 支持 Markdown 图文混排；`label` 保持短纯文本。图片写为 `![说明](https://example.com/image.png)` 或 `![说明](<C:/work folder/image.png>)`。图文通过公开的 session 插槽 `proactive.question.content` 渲染，只有显示文本传给扩展；缺少扩展时保留原文。选择按钮与图文分离，点图或链接不会误选，提交仍返回原始标签。

面板与聊天内容列对齐，使用宿主主题颜色。选项以无边框列表展示，标题与说明同行并自动换行；选中时显示底色和勾选标记。自由回答区使用透明背景，底部操作保持可见。窄屏允许操作区换行，长选项在面板内滚动。新问题与保留的问题使用同一布局，桌面内容两侧留白 24px，窄屏留白 16px；选项使用 20px 行距、8px 上下内边距和 2px 间隔。

多个问题可用页码箭头切换，单题隐藏分页。关闭按钮收起面板，问题仍保留；点击标题栏重新展开。提交发送回答，跳过不发送消息。

布局由本插件维护，不再逐条复制阻塞式提问卡片。样式检查约束主题变量与可访问性，浏览器验证覆盖选中、输入、切换、收起及窄屏布局。

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
| 单元测试 | `npm test` | 协议、store、倒计时算术、重绘时钟、主题变量与滚动布局。沙箱里渲染不出东西，**只能证明接线**。 |
| 产物测试 | `npm test`（含 `client-bundle.test.mjs`） | 直接对 `lib/client.js` 断言：不出现裸 `React.createElement`、两个槽位都注册。 |
| 渲染冒烟 | `node tests/render-smoke.mjs` | 用真 React + jsdom 渲染**构建产物**，断言用户真正看到的东西，并盯住注入的样式表。 |
| 视觉预览 | `npm run test:visual -- <chromium> <playwright-core> <out-dir> [dark\|light] [newest\|oldest]` | 检查选择、分页、草稿保留、收起和窄屏溢出，并输出深浅主题截图。 |
| 对话列几何 | `node tests/measure-dock.mjs <chromium> <playwright-core>`，设置 `DSH_SOURCE_ROOT` | 使用已安装的 React 18，测量四种对话列宽度；渲染错误或空卡片会失败，仅测试深色主题。 |

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

## Plugin display metadata

The plugin list shows **Proactive questions** in English and **主动提问** in Chinese, following the DSH interface language. `locale/en.json` and `locale/zh.json` provide the title and description; `icon.svg` supplies self-contained artwork. The package exports and publishes these resources. The icon is adapted from Lucide; see [ICON_LICENSE.txt](ICON_LICENSE.txt).

The icon uses a centered 36 × 36 viewBox to leave more space around the artwork inside the plugin icon frame.
