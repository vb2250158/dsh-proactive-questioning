# DSH 主动提问（私有）

这是独立的 DSH 插件，不依赖 Rabi、RabiRoute、情感交流资料库、角色人格或任何真人聊天记录。

它向所有 DSH 对话全局提供 `queue_user_question`：Agent 可以在推理时把一个可选问题放进当前对话，而工具立即成功返回，Agent 继续工作。问题不设超时；不回答不是同意，也不会使 Agent 卡住。

界面是每个会话独立的。问题在 Agent 提问的那一刻就出现在输入框上方——不等工具返回，所以不会被后续输出挤到看不见的地方。面板里最新的问题展开成选项按钮和自由输入框，更早的未答问题折叠成单行（可单独“回答”或“跳过”）。提交回答会作为一条新的用户消息发送到该对话；跳过不发送消息，也不会篡改旧工具调用。浏览器仅保存关闭状态和首次显示时间，不另存问题正文或回答。

这不是官方阻塞式 `ask_user_question` 的替代实现。它把“想听听你的看法”与“必须等待的批准/选择”分开：日常主动询问使用本插件，Agent 不得把沉默当作回答。

## 本机开发

```powershell
pnpm install
pnpm check
```

`pnpm build` 生成私有 DSH 插件的 Host 与 Web ModuleLoader bundle。加入 Web Profile、重启 DSH 并刷新网页后，新会话和已有会话的后续工具调用都可使用它。

## 两条会话身份通道（改动前必读）

- **工具行**：`tool.call.toolview` 的组件从 props 拿 `sessionId`——session 作用域的槽位组件会合并 `SessionStandardProps`。官方 `ask_user_question` 视图也是这么做的。
- **输入框上方面板**：`conversation.input.dock` 是 session 作用域，注册时的 `inject` 工厂收到的是**位置参数** `inject(sessionId)`，不是 props 对象。

写成 `inject: (props) => props.sessionId` 会让每个 occurrence 都解析不到会话，面板永远返回 `null` —— 这正是「问题从来没弹出来」的根因。参照 `ui-goal` 的 `GoalDock`（占同一槽位）：`inject: (sessionId) => …`。详见 `docs/DESIGN.md`。
