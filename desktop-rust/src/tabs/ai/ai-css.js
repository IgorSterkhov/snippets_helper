export function aiCSS() {
  return `
.ai-agent-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-primary);
  color: var(--text);
}
.ai-agent-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.ai-agent-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #f0f6fc;
}
.ai-status-pill {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}
.ai-agent-body {
  display: flex;
  gap: 10px;
  min-height: 0;
  flex: 1;
  padding: 10px;
}
.ai-chat-pane,
.ai-log-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
}
.ai-chat-pane {
  flex: 1 1 auto;
  min-width: 0;
}
.ai-log-pane {
  width: 320px;
  flex: 0 0 320px;
}
.ai-pane-title {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.ai-response {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.ai-response.empty,
.ai-execution-log.empty {
  color: var(--text-muted);
}
.ai-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--border);
  background: rgba(13, 17, 23, 0.35);
}
.ai-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-mode-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-primary);
}
.ai-mode-btn {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
}
.ai-mode-btn:last-child {
  border-right: 0;
}
.ai-mode-btn.active {
  background: var(--accent);
  color: #fff;
}
.ai-input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.ai-input {
  flex: 1;
  min-height: 72px;
  max-height: 180px;
  resize: vertical;
  color: var(--text);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
  line-height: 1.4;
}
.ai-send-btn,
.ai-mic-btn {
  height: 34px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 12px;
}
.ai-send-btn {
  min-width: 72px;
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  font-weight: 700;
}
.ai-mic-btn {
  width: 38px;
  background: var(--bg-tertiary);
  color: var(--text);
}
.ai-send-btn:disabled,
.ai-mic-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.ai-execution-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  font-size: 12px;
}
.ai-log-item {
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  margin-bottom: 8px;
}
.ai-log-item.executed {
  border-left: 3px solid var(--success, #3fb950);
}
.ai-log-item.failed {
  border-left: 3px solid var(--danger, #f85149);
}
.ai-log-item.needs_clarification {
  border-left: 3px solid #d29922;
}
.ai-log-name {
  color: #f0f6fc;
  font-weight: 700;
  margin-bottom: 4px;
}
.ai-log-message {
  color: var(--text-muted);
  line-height: 1.35;
}
.ai-log-choices {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ai-log-choice {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  background: var(--bg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-error {
  color: var(--danger);
}
`;
}
