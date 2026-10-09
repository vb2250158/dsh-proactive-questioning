# Answer delivery and presentation

Version 0.1.11 sends a single-choice answer immediately when its option is clicked. This changes the previous select-then-submit interaction. Multi-select answers retain an explicit Send answer action. Free text sends with Enter or that action; Shift+Enter inserts a newline. While admission is pending, the question is disabled. Success closes it; failure retains its draft and displays the failure for retry.

Delivery uses the scoped public Conversation send method, which queues the answer on its original session. It never writes to the main composer draft. Queued answers are handled after the active turn finishes.

Answer receipts separate the question, chosen labels and additional text. Existing complete answer envelopes receive the same presentation. Copy preserves the full logged text, including original labels and identity. Invalid or extended envelopes retain their original text. No transcript migration or model-input rewrite occurs.

The plugin replaces the public user and steering keyed Chat renderers at priority 100. Its ordinary-message presentation retains authorized image galleries, file metadata, reference and skill projection, timestamps, extra content and copy. It does not import the host's internal renderer. Disposing the plugin restores the lower-priority host entries.

Validation: npm run check tests the built client, direct-send admission, same-tick duplicate clicks, retry, multi-select, legacy answer receipts and ordinary messages. The answer preview exercises desktop and narrow-screen receipts in light, dark and custom theme tokens.
