# Answer delivery and presentation

Complete answer envelopes are presented by a business text node within the official user row. Submission echoes, pending steering and durable messages share the host row, including attachment previews, timestamps and copying the original text.

Version 0.1.11 sends a single-choice answer immediately when its option is clicked. This changes the previous select-then-submit interaction. Multi-select answers retain an explicit Send answer action. Free text sends with Enter or that action; Shift+Enter inserts a newline. While admission is pending, the question is disabled. Success closes it; failure retains its draft and displays the failure for retry.

Delivery uses the scoped public Conversation send method, which queues the answer on its original session. It never writes to the main composer draft. Queued answers are handled after the active turn finishes.

Answer receipts place the question and answered status in one compact header, with chosen labels and additional text below. Short answers size to their content. Existing complete answer envelopes receive the same presentation. Copy preserves the full logged text, including original labels and identity. Invalid or extended envelopes retain their original text. No transcript migration or model-input rewrite occurs.

The plugin registers a user-text rule and a keyed business text node. Ordinary and malformed messages are untouched. The host owns the message row, attachments, timestamp and copy; disabling the plugin restores the original text.

Validation covers the built client, direct-send admission, retry, multi-select, recognized answer nodes and unmatched ordinary text.
