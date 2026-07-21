/* FlowForge Forgekin Council Chat — frontend logic
 * Loads 5 forgekins from /api/agents, renders sidebar + chat, handles send.
 * Supports @mention dropdown, real-time WebSocket, T7/T8 verify buttons.
 */

const API_BASE = "";
let agents = [];
let agentMap = {};
let messages = [];
let ws = null;

// ── DOM helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMentions(content) {
  // Highlight @文心 / @夏洛克 / @梵高 / @达芬奇 / @鲁班 / @Operator
  let html = escapeHtml(content);
  for (const agent of agents) {
    const re = new RegExp(`@${agent.name}`, "g");
    html = html.replace(re, `<span class="mention">@${agent.name}</span>`);
  }
  html = html.replace(/@Operator/g, '<span class="mention">@Operator</span>');
  return html;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Render ─────────────────────────────────────────────────────

function renderSidebar() {
  const sidebar = $(".council-sidebar");
  const forgekinsHtml = agents.map((a) => `
    <div class="forgekin-card" data-id="${a.id}" onclick="mentionForgekin('${a.id}')">
      <div class="avatar">${a.avatar}</div>
      <div class="info">
        <div class="name">${a.name} <span style="color:var(--text-muted);font-weight:400;font-size:11px">${a.alias}</span></div>
        <div class="meta">${a.vendor} · ${a.loop_type} · ${a.awakening_stage}</div>
      </div>
      ${a.requires_approval ? '<span class="approval-badge" title="I8 framework changes require operator approval">I8</span>' : ""}
      <div class="status-dot" title="online"></div>
    </div>
  `).join("");
  sidebar.innerHTML = `
    <h2>Council Members (5)</h2>
    ${forgekinsHtml}
    <h2 style="margin-top:20px">Protocol</h2>
    <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">
      <div>✓ Five-step loop (P31)</div>
      <div>✓ Quality threshold 0.85 (P33)</div>
      <div>✓ No-self-review (I9)</div>
      <div>✓ Framework approval (I8)</div>
      <div>✓ Push back ≤ 3 rounds</div>
    </div>
  `;
}

function renderMessage(msg) {
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${msg.author_role}`;
  bubble.dataset.messageId = msg.message_id;
  bubble.innerHTML = `
    <div class="author">
      <span class="avatar">${msg.author_avatar}</span>
      <span>${escapeHtml(msg.author_name)}</span>
    </div>
    <div class="content">${formatMentions(msg.content)}</div>
    <div class="timestamp">${formatTime(msg.timestamp)}</div>
    <div class="trace-id">${msg.trace_id}</div>
  `;
  return bubble;
}

function appendMessage(msg) {
  const container = $(".chat-messages");
  container.appendChild(renderMessage(msg));
  container.scrollTop = container.scrollHeight;
}

function renderHistory(history) {
  const container = $(".chat-messages");
  container.innerHTML = "";
  for (const msg of history) {
    appendMessage(msg);
  }
}

function showTyping() {
  let indicator = $(".typing-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = '<span class="dots"><span></span><span></span><span></span></span> 灵智体正在协作...';
    $(".chat-messages").appendChild(indicator);
  }
  indicator.classList.add("visible");
  $(".chat-messages").scrollTop = $(".chat-messages").scrollHeight;
}

function hideTyping() {
  const indicator = $(".typing-indicator");
  if (indicator) indicator.classList.remove("visible");
}

// ── API ────────────────────────────────────────────────────────

async function loadAgents() {
  const res = await fetch(`${API_BASE}/api/agents`);
  const data = await res.json();
  agents = data.agents || [];
  agentMap = {};
  for (const a of agents) agentMap[a.id] = a;
  renderSidebar();
}

async function loadMessages() {
  const res = await fetch(`${API_BASE}/api/messages?limit=50`);
  const data = await res.json();
  messages = data.messages || [];
  renderHistory(messages);
}

async function sendMessage() {
  const input = $("#message-input");
  const content = input.value.trim();
  if (!content) return;

  const sendBtn = $("#send-button");
  sendBtn.disabled = true;
  input.value = "";
  autoResize(input);
  hideMentionDropdown();

  // Optimistic: show operator message immediately
  // (the API response will also include it; we dedupe by message_id)
  showTyping();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, mentions: extractMentions(content) }),
    });
    const data = await res.json();
    // Append user message if not already in DOM
    const existing = document.querySelector(`[data-message-id="${data.user_message.message_id}"]`);
    if (!existing) {
      appendMessage(data.user_message);
    }
    hideTyping();
    // Append each forgekin response
    for (const resp of data.forgekin_responses) {
      await new Promise((r) => setTimeout(r, 100));
      appendMessage(resp);
    }
  } catch (err) {
    hideTyping();
    appendMessage({
      message_id: `err-${Date.now()}`,
      author_id: "system",
      author_name: "System",
      author_role: "forgekin",
      author_avatar: "⚠️",
      content: `发送失败: ${err.message}`,
      timestamp: new Date().toISOString(),
      trace_id: `err-${Date.now()}`,
    });
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function extractMentions(content) {
  const mentions = [];
  for (const agent of agents) {
    if (content.includes(`@${agent.name}`) || content.includes(`@${agent.alias}`)) {
      mentions.push(agent.id);
    }
  }
  return mentions;
}

// ── @mention dropdown ──────────────────────────────────────────

function handleInputChange(e) {
  const input = e.target;
  autoResize(input);
  const value = input.value;
  const cursorPos = input.selectionStart;
  // Detect @mention pattern
  const beforeCursor = value.substring(0, cursorPos);
  const match = beforeCursor.match(/@(\w*)$/);
  if (match) {
    const query = match[1].toLowerCase();
    const matches = agents.filter(
      (a) => a.name.toLowerCase().includes(query) || a.alias.toLowerCase().includes(query)
    );
    if (matches.length > 0) {
      showMentionDropdown(matches, input);
    } else {
      hideMentionDropdown();
    }
  } else {
    hideMentionDropdown();
  }
}

function showMentionDropdown(matches, input) {
  let dropdown = $(".mention-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "mention-dropdown";
    document.body.appendChild(dropdown);
  }
  dropdown.innerHTML = matches
    .map(
      (a) => `
      <div class="mention-item" onclick="insertMention('${a.name}')">
        <span>${a.avatar}</span>
        <span>${a.name}</span>
        <span style="color:var(--text-muted);font-size:11px">${a.vendor}</span>
      </div>
    `
    )
    .join("");
  // Position below input
  const rect = input.getBoundingClientRect();
  dropdown.style.top = `${rect.top - 200}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.width = `${rect.width}px`;
  dropdown.classList.add("visible");
}

function hideMentionDropdown() {
  const dropdown = $(".mention-dropdown");
  if (dropdown) dropdown.classList.remove("visible");
}

function insertMention(name) {
  const input = $("#message-input");
  const value = input.value;
  const cursorPos = input.selectionStart;
  const beforeCursor = value.substring(0, cursorPos);
  const afterCursor = value.substring(cursorPos);
  const newBefore = beforeCursor.replace(/@(\w*)$/, `@${name} `);
  input.value = newBefore + afterCursor;
  input.focus();
  const newPos = newBefore.length;
  input.setSelectionRange(newPos, newPos);
  hideMentionDropdown();
}

function mentionForgekin(fkId) {
  // Clicking a sidebar card inserts @<name> into the input
  const agent = agentMap[fkId];
  if (!agent) return;
  const input = $("#message-input");
  input.value = `@${agent.name} `;
  input.focus();
}

// ── Input auto-resize ──────────────────────────────────────────

function autoResize(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

// ── WebSocket ──────────────────────────────────────────────────

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${location.host}/ws`;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => console.log("[ws] connected");
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "history") {
      // Already loaded via REST; skip
    } else if (data.type === "new_message") {
      // Avoid duplicating messages we just sent
      const existing = document.querySelector(`[data-message-id="${data.message.message_id}"]`);
      if (!existing) {
        appendMessage(data.message);
      }
    }
  };
  ws.onclose = () => {
    console.log("[ws] disconnected, reconnecting in 3s");
    setTimeout(connectWebSocket, 3000);
  };
  // Heartbeat
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 30000);
}

// ── T7/T8 verification ─────────────────────────────────────────

async function runT7Verify() {
  const res = await fetch(`${API_BASE}/api/verify/t7`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: 20 }),
  });
  const data = await res.json();
  const result = $("#t7-result");
  result.textContent = `audited=${data.audited_messages} issues=${data.issues.length} score=${data.quality_score.toFixed(2)} ${data.passed ? "PASS" : "FAIL"}`;
  result.className = `verify-result ${data.passed ? "pass" : "fail"}`;
}

async function runT8Verify() {
  const res = await fetch(`${API_BASE}/api/verify/t8`);
  const data = await res.json();
  const results = [];
  let passCount = 0;
  for (const check of data.checklist) {
    const el = document.querySelector(check.selector);
    let ok = !!el;
    let detail = "";
    if (ok && check.expected_count) {
      const count = document.querySelectorAll(check.selector).length;
      ok = count === check.expected_count;
      detail = `${count}/${check.expected_count}`;
    } else if (ok && check.expected_min_count) {
      const count = document.querySelectorAll(check.selector).length;
      ok = count >= check.expected_min_count;
      detail = `${count}≥${check.expected_min_count}`;
    } else if (ok) {
      detail = "present";
    } else {
      detail = "missing";
    }
    const status = ok ? "PASS" : "FAIL";
    if (ok) passCount++;
    const shortName = check.description || check.selector;
    results.push(`${shortName}: ${detail} [${status}]`);
  }
  const allPass = passCount === results.length;
  const result = $("#t8-result");
  result.textContent = `${passCount}/${results.length} ${allPass ? "ALL PASS" : "FAIL"}`;
  result.className = `verify-result ${allPass ? "pass" : "fail"}`;
  console.log("T8 details:", results);
}

// ── Init ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadAgents();
  await loadMessages();
  connectWebSocket();

  const input = $("#message-input");
  const sendBtn = $("#send-button");

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("input", handleInputChange);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.focus();
});
