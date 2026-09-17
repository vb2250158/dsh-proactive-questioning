# 非阻塞反问合同

## 时序

1. Agent 调用 `queue_user_question`，工具立即返回 `{ status: "queued" }`。
2. Agent 在同一回合继续推理，不等待、不中断、也不假设回答。
3. Web 端从该工具调用读取问题——**调用进行中就读取**（arguments 一落地就显示），不等工具返回。
4. 问题留在当前会话输入框上方的面板里，直到用户回答或跳过；面板把最新的问题展开成可选选项与自由输入，更早的未答问题折叠成单行。
5. 提问后的前 120 秒，最新问题带“新”强调；超过该窗口仍保持未答，只是不再强调。**没有任何到期或自动关闭**。
6. 用户提交时，答案作为新的用户消息进入同一会话；跳过或“全部跳过”只关闭本地 UI 条目。

## 隔离与隐私

- 问题按 `sessionId + tool call id + question id` 隔离，不跨对话显示。
- 浏览器本地只保存首次显示时间与 answered/skipped 状态，不能由它重建问题正文、选项或回答。首次显示时间在**入队时**就写入，因此刷新页面会继续沿用原来的时钟，不会让一个旧问题重新“变新”。
- 某个会话的未答问题全部结算后，该会话在内存里的条目会被清掉（网页不会随会话数增长而一直堆积）。
- 真正的问题参数仍由既有 DSH 会话记录保存；真正的回答只在用户主动提交后写为新的用户消息。
- 本插件不读工作区、Rabi 数据、情感资料或联系方式。

## 呈现之所以固定在输入框上方

该面板挂在 `conversation.input.dock`（composer 卡片上方的全宽区），注册在 session 作用域。

**会话身份来自注册声明，不来自 props。** 客户端槽位系统按注册时的声明推导 inject 的实参：`session` 作用域的工厂被调用为 `inject(sessionId)`，id 是**位置参数**（见 `@deepseek-ai/dsh-client-ui-slots` 的 `InjectParams`，以及渲染器 `scoped-slots.tsx` 的 `runInject`——它把 `binding.key` 压进实参数组）。所以工厂的第一个参数就是 id 字符串本身，永远不是 props 对象。`ui-goal` 的 `GoalDock` 占着同一个槽位，签名正是 `inject: (sessionId) => …`，本插件的写法与它一致。

把工厂写成收 props 再读 `props.sessionId`，会让每个 occurrence 都解析到 `undefined`：`binding` 恒为空 → `useQuestions` 恒返回空数组 → `QuestionDock` 每次都返回 `null`，任何会话都不渲染。这就是“压根没见它弹出来”的根因。改动 `src/client/index.ts` 的注册前请先确认实参是位置参数。

组件侧另有一条：`session` 作用域的槽位组件会合并 `SessionStandardProps`（由 `ui-session` 合入 `sessionId` / `useSession` / `useProjection`），所以 **`sessionId` 在 props 上是真实存在的**，工具行正是这么拿身份的（官方 `ask_user_question` 视图同理）。两条路径的区别只在于「给组件的 props」与「给 inject 工厂的实参」，不要混用。

回答经 apply 闭包中的 `ctx.sessions.scope(id).conversation` 投递——这是 `ui-conversation` 文档化的按作用域寻址发送（"address one via `ctx.sessions.scope(id).conversation`"），不需要 `uiSession.adapter.resolve`，也不再往 occurrence 上传绑定对象。

## 关闭语义

- “跳过”：关闭一条，不给 Agent 伪造回答。
- “全部跳过”：关闭当前面板所有未答项，不跨会话。
- 关闭后重新刷新，浏览器仍会保持关闭状态；但不会阻止新一次工具调用创建新问题。
