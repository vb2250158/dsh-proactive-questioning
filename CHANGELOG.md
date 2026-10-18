# Changelog

## 0.1.15 (2026-10-19)

- 图片兼容公开 gallery Factory，保留宿主授权读取能力。
- Use the public gallery Factory while preserving Host-authorized image loading.

- 回答卡片兼容 rc.2 的 conversation.user.text Factory，并保留旧宿主投影。
- Render answer cards through the rc.2 user-text Factory while retaining legacy Host projection.

## 0.1.14 (2026-10-13)

- 修正消息渲染优先级；通过公开 Component Factory 与 Rabi 来源卡片共存。
- Correct the ascending renderer priority and share answer cards through a public Component Factory without replacing Rabi source envelopes.

## 0.1.13 (2026-10-10)

- 回答卡片将问题与已回答状态放在同一行，收紧内边距和选项间距，短回答按内容收窄。
- Compact answer receipts combine the question and status in one header, reduce padding and selection spacing, and size short answers to their content.

## 0.1.12 (2026-10-09)

- 回答卡片不再重复声明问题内容插槽，恢复提问面板与消息渲染。
- Keep the question-content slot under its dock owner so answer renderers load without duplicate declarations.

## 0.1.11 (2026-10-09)

- 单选点击即发送；多选与自由文字保留发送操作。发送失败保留回答，阻止重复点击。
- 回答消息显示为卡片，兼容旧版消息，保留时间、复制、普通消息、附件与引用。
- Send single-choice answers on click; retain explicit send for multi-select and free text, preserve failed drafts and prevent duplicate admission.
- Present current and historical answers as cards while retaining copy, timestamps, ordinary messages, attachments and references.

## 0.1.10 (2026-10-07)

- 缩小图标绘制内容约三分之一，增加方框内的留白。
- Reduce icon artwork by one third with a centered, padded viewBox.

## 0.1.9 (2026-10-07)

- 为插件列表提供中英文名称与说明，并发布独立的 SVG 图标。
- Publish English and Chinese plugin display metadata and a dedicated SVG icon.
